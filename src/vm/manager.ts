import { execSync as nodeExecSync, exec as nodeExec } from "child_process";
import { promisify } from "util";
import { existsSync, unlinkSync, writeFileSync as fsWriteFileSync, mkdirSync as fsMkdirSync } from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import { t } from "../i18n/index.js";
import { VM_DEFAULTS, derivePassword, getDataDiskPath, GOLDEN_VERSION_FILE, type VmHandle, type VmInfo, type VmOperationResult, type VmSpec } from "./types.js";
import { generateCloudInitIso } from "./cloud-init.js";
import { getOrCreateServerPassword, getUserVmSpecTier } from "../settings/manager.js";
import { fireVmAlarmBg } from "./alarm.js";
import type { VmStatePersistence, VmStateRecord } from "./state-persistence.js";
import { createLibvirtHealthProxy, type HealthStatus } from "./health-proxy.js";
import { deployFullUpdate, type FullUpdatePayload } from "./ssh-inject.js";
import { injectViaGuestfish, DEFAULT_GUESTFISH_FIXES } from "./guestfish-inject.js";
import { readGoldenVersion } from "./version-check.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic MAC: 52:54:00 + 3 bytes from userId hash (avoid conflicts) */
function generateMacForUser(userId: number): string {
  const h = knuthHash(userId);
  const b0 = (h >>> 16) & 0xff;
  const b1 = (h >>> 8) & 0xff;
  const b2 = h & 0xff;
  return `52:54:00:${b0.toString(16).padStart(2, "0")}:${b1.toString(16).padStart(2, "0")}:${b2.toString(16).padStart(2, "0")}`;
}

/** Deterministic last octet of IP: 10.100.0.<10-250> from userId hash */
function generateIpForUser(userId: number): string {
  const h = knuthHash(userId);
  const octet = (h % 241) + 10; // 10..250
  return `192.168.123.${octet}`;
}

/** Knuth's multiplicative hash — good distribution for integer keys */
function knuthHash(n: number): number {
  return ((n * 2654435761) >>> 0);
}

/** Deterministic IPv6 from VPS /64 range: 2607:9d00:2000:1f6::<hash%2^64>
 *  Address ::1 is reserved for gateway. User addresses start from ::2.
 *  Returns fully-expanded format (no :: shorthand) for iproute2 compatibility. */
export function generateIpv6ForUser(userId: number): string {
  const h = knuthHash(userId);
  const host = BigInt(h >>> 0) % ((1n << 64n) - 2n) + 2n;
  const hex = host.toString(16).padStart(16, "0");
  const groups = hex.match(/.{1,4}/g)!.join(":");
  return `2607:9d00:2000:1f6:${groups}`;
}

export class VmManager {
  private execSyncFn: typeof nodeExecSync;

  constructor(execSyncFn?: typeof nodeExecSync) {
    this.execSyncFn = execSyncFn ?? nodeExecSync;
  }

  /** Run a command asynchronously — does NOT block the event loop.
   *  Use for disk I/O (qemu-img) and network I/O (ssh) during VM deployment
   *  to prevent freezing all other users. */
  private execAsync(command: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = nodeExec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
      // Prevent the child process from keeping the event loop alive after resolve/reject
      if (child.stdout) child.stdout.destroy();
      if (child.stderr) child.stderr.destroy();
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      this.execSyncFn("which virsh", { stdio: "ignore" });
      this.execSyncFn("which qemu-img", { stdio: "ignore" });
      return true;
    } catch {
      logger.warn("[VmManager] virsh or qemu-img not found — VM deployment unavailable");
      return false;
    }
  }

  async ensureBaseImage(): Promise<VmOperationResult> {
    const imagePath = path.join(VM_DEFAULTS.imagesDir, VM_DEFAULTS.baseImageName);
    if (existsSync(imagePath)) {
      return { success: true };
    }
    return {
      success: false,
      error: `Base image not found at ${imagePath}. Run image-builder first.`,
    };
  }

  async ensureNetwork(): Promise<VmOperationResult> {
    const netName = VM_DEFAULTS.networkName;
    const subnet = VM_DEFAULTS.networkSubnetCidr;
    try {
      const check = this.execSyncFn(`sudo virsh net-info ${netName}`, {
        stdio: "pipe",
        encoding: "utf-8",
      }) as string;
      if (check.includes("Active:") && check.includes("yes")) {
        // Network is active — fix routing and verify bridge
        this.fixVmRouting(subnet);
        return { success: true };
      }
      this.execSyncFn(`sudo virsh net-start ${netName}`, { stdio: "pipe" });
      this.execSyncFn(`sudo virsh net-autostart ${netName}`, { stdio: "ignore" });
      logger.info(`[VmManager] Network ${netName} started`);
      this.fixVmRouting(subnet);
      return { success: true };
    } catch {
      const netXml = `<network>
  <name>${netName}</name>
  <bridge name="${VM_DEFAULTS.networkBridge}" stp="off" delay="0"/>
  <forward mode="nat"/>
  <ip address="${VM_DEFAULTS.networkHostIp}" netmask="255.255.255.0">
    <dhcp>
      <range start="${VM_DEFAULTS.networkDhcpStart}" end="${VM_DEFAULTS.networkDhcpEnd}"/>
    </dhcp>
  </ip>
</network>`;
      const tmpPath = `/tmp/libvirt-net-${netName}.xml`;
      const write = (fsWriteFileSync);
      write(tmpPath, netXml);
      this.execSyncFn(`sudo virsh net-define ${tmpPath}`, { stdio: "pipe" });
      this.execSyncFn(`sudo virsh net-start ${netName}`, { stdio: "pipe" });
      this.execSyncFn(`sudo virsh net-autostart ${netName}`, { stdio: "ignore" });
      logger.info(`[VmManager] Network ${netName} created and started`);
      this.fixVmRouting(subnet);
      return { success: true };
    }
  }

  /** Fix Tailscale route conflict: ensure local VM subnet traffic goes through virbr1, not tailscale0.
   *  VMs advertise 10.100.0.0/24 via Tailscale, which creates a table-52 route that overrides the
   *  local bridge route. We add a higher-priority ip rule to use the main table for this subnet. */
  private fixVmRouting(subnet: string): void {
    try {
      // Remove any stale Tailscale route in table 52 for our subnet
      this.execSyncFn(`sudo ip rule del to ${subnet} table 52 2>/dev/null || true`, { stdio: "ignore" });
      // Add high-priority rule to route local subnet through main table (virbr1)
      this.execSyncFn(`sudo ip rule add to ${subnet} table main priority 100 2>/dev/null || true`, { stdio: "ignore" });
    } catch { /* non-fatal — routing fix is best-effort */ }
  }

  async addVmIpv6Route(domainName: string, ipv6: string): Promise<void> {
    try {
      const list = this.execSyncFn(
        `sudo virsh domiflist ${domainName}`,
        { encoding: "utf-8", stdio: "pipe" },
      ) as string;
      const vnetLine = list.split("\n").find(l => l.includes("vnet"));
      if (!vnetLine) return;
      const iface = vnetLine.trim().split(/\s+/)[0];
      this.execSyncFn(`sudo ip -6 route add ${ipv6}/128 dev ${iface}`, { stdio: "ignore" });
    } catch { /* non-fatal */ }
  }

  async addVpsIpv6Route(ipv6: string): Promise<void> {
    try {
      await this.execAsync(
        `ssh -o ConnectTimeout=5 root@192.129.148.93 ip -6 route add ${ipv6}/128 dev wg1`,
        10_000,
      );
    } catch { /* non-fatal */ }
  }

  async createAndStart(
    userId: number,
    spec: VmSpec,
    deps?: {
      opencodePassword?: string;
      sudoPassword?: string;
      writeFileSync?: typeof fsWriteFileSync;
      mkdirSync?: typeof fsMkdirSync;
      dhcpRetryDelayMs?: number;
      onProgress?: (step: string) => void;
    },
  ): Promise<VmInfo> {
    const report = deps?.onProgress ?? (() => {});
    const opencodePw = deps?.opencodePassword ?? getOrCreateServerPassword(userId);
    const sudoPw = deps?.sudoPassword ?? derivePassword(userId, spec.tier);
    const write = deps?.writeFileSync ?? fsWriteFileSync;
    const mkdir = deps?.mkdirSync ?? fsMkdirSync;

    const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
    const baseImage = path.join(VM_DEFAULTS.imagesDir, VM_DEFAULTS.baseImageName);
    const clonePath = path.join(VM_DEFAULTS.imagesDir, `${domainName}.qcow2`);
    const isoPath = path.join(VM_DEFAULTS.imagesDir, `cloud-init-${userId}.iso`);
    const xmlPath = path.join(VM_DEFAULTS.imagesDir, `${domainName}.xml`);

    report(t("vm.progress.setup_access"));
    try {
      this.execSyncFn(`sudo setfacl -m u:libvirt-qemu:x ${path.dirname(VM_DEFAULTS.imagesDir)}`, { stdio: "ignore" });
      this.execSyncFn(`sudo setfacl -m u:libvirt-qemu:x ${VM_DEFAULTS.imagesDir}`, { stdio: "ignore" });
    } catch { /* non-fatal — may already be set */ }

    report(t("vm.progress.setup_network"));
    await this.ensureNetwork();

    report("Enabling KSM");
    await this.ensureKsm();

    // SAFETY CHECK (2026-07-02): NEVER destroy/undefine an existing user VM —
    // it may contain the user's data. If the domain already exists, fire an
    // admin alarm and skip provisioning. Only clean up if the domain does NOT
    // exist (true first-time provisioning, no user data at risk).
    report(t("vm.progress.cleanup_vm"));
    const domainExists = this.domainExists(domainName);
    if (domainExists) {
      const existingState = this.domainState(domainName);
      fireVmAlarmBg({
        severity: "CRITICAL",
        userId,
        domainName,
        reason: `createAndStart would have destroyed existing domain (state: ${existingState}). User data at risk. Provisioning BLOCKED.`,
        blockedAction: `virsh destroy ${domainName} + virsh undefine ${domainName} + rm -f ${clonePath}`,
        caller: "VmManager.createAndStart",
        source: "manager.ts:211-224",
        timestamp: new Date().toISOString(),
      });
      throw new Error(
        `VM domain '${domainName}' already exists (state: ${existingState}). ` +
        `Provisioning blocked to protect user data. Admin has been notified.`,
      );
    }
    // Safe cleanup: only if domain does NOT exist (no user data at risk)
    try {
      this.execSyncFn(`sudo rm -f ${clonePath}`, { stdio: "ignore" });
    } catch { /* file didn't exist — ok */ }
    try {
      this.execSyncFn(`sudo rm -f ${isoPath}`, { stdio: "ignore" });
    } catch { /* file didn't exist — ok */ }

    // Create persistent data disk if it doesn't exist (survives VM recreation)
    // Size matches user's spec tier (thin-provisioned qcow2, physical size grows as needed)
    const dataDiskPath = getDataDiskPath(userId);
    if (!existsSync(dataDiskPath)) {
      await this.execAsync(`sudo qemu-img create -f qcow2 ${dataDiskPath} ${spec.diskGb}G`, 30_000);
    }

    // Reserve deterministic IP for this user to prevent conflicts
    const reservedMac = generateMacForUser(userId);
    const reservedIp = generateIpForUser(userId);
    try {
      // Remove any stale reservation for this MAC
      const deleteCmd = `sudo virsh net-update ${VM_DEFAULTS.networkName} delete ip-dhcp-host "<host mac='${reservedMac}' />" --live --config --parent-index 0`;
      const addCmd = `sudo virsh net-update ${VM_DEFAULTS.networkName} add ip-dhcp-host "<host mac='${reservedMac}' ip='${reservedIp}' />" --live --config --parent-index 0`;
      try { this.execSyncFn(deleteCmd, { stdio: "pipe" }); } catch { /* no stale entry */ }
      this.execSyncFn(addCmd, { stdio: "pipe" });
      logger.info(`[VmManager] Reserved IP ${reservedIp} for user ${userId} (MAC ${reservedMac})`);
    } catch (e) {
      logger.warn(`[VmManager] DHCP reservation failed for user ${userId}: ${e}`);
    }

    report(t("vm.progress.clone_image"));
    // OS overlay: fixed size (20 GB — enough for OS + deps + skills)
    const OS_DISK_GB = 20;
    await this.execAsync(
      `sudo qemu-img create -f qcow2 -b ${baseImage} -F qcow2 ${clonePath} ${OS_DISK_GB}G`,
      60_000,
    );

    report(t("vm.progress.cloud_init"));
    const ipv6 = generateIpv6ForUser(userId);
    generateCloudInitIso(userId, spec, opencodePw, sudoPw, isoPath, this.execSyncFn, write, mkdir, ipv6);

    const domainXml = this.buildDomainXml(domainName, clonePath, isoPath, spec, userId, dataDiskPath);
    write(xmlPath, domainXml);

    report(t("vm.progress.define_vm"));
    this.execSyncFn(`sudo virsh define ${xmlPath}`, { stdio: "pipe" });

    report(t("vm.progress.start_vm"));
    this.execSyncFn(`sudo virsh start ${domainName}`, { stdio: "pipe" });

    // Add IPv6 routes for this VM
    await this.addVmIpv6Route(domainName, ipv6);
    await this.addVpsIpv6Route(ipv6);

    report(t("vm.progress.wait_ip"));
    const bridgeIp = await this.getBridgeIp(userId, deps?.dhcpRetryDelayMs);
    if (!bridgeIp) {
      throw new Error(`VM started but DHCP lease not obtained within ${((VM_DEFAULTS.dhcpRetries * VM_DEFAULTS.dhcpRetryDelayMs) / 1000).toFixed(0)}s`);
    }
    const host = bridgeIp;

    // Verify VM actually boots (cloud-init completes). Non-blocking — warn if stuck.
    this.verifyVmBoot(domainName, 300_000).then(booted => {
      if (!booted) {
        logger.warn(`[VmManager] VM ${domainName} did not complete cloud-init within 5min`);
      }
    });

    return {
      userId,
      tier: spec.tier,
      domainName,
      qcow2Path: clonePath,
      cloudInitIsoPath: isoPath,
      bridgeIp,
      baseUrl: `http://${host}:${VM_DEFAULTS.opencodePort}`,
      startTime: new Date().toISOString(),
      pid: null,
      sudoPassword: sudoPw,
      serverPassword: opencodePw,
      ipv6: generateIpv6ForUser(userId),
    };
  }

  /** Check VM console log for cloud-init completion within timeout.
   *  Returns true if cloud-init finished, false on timeout or kernel hang. */
  async verifyVmBoot(domainName: string, timeoutMs?: number): Promise<boolean> {
    const deadline = Date.now() + (timeoutMs ?? 300_000);
    let lastLineCount = 0;
    let stallCount = 0;
    while (Date.now() < deadline) {
      try {
        const log = this.execSyncFn(
          `sudo cat /var/log/libvirt/qemu/${domainName}-console.log 2>/dev/null || echo ""`,
          { encoding: "utf-8", stdio: "pipe" },
        ) as string;
        if (log.includes("Cloud-init v.") && log.includes("finished")) {
          return true;
        }
        // Detect kernel hang: if log has lines but isn't growing for 60 checks (120s).
        // Cloud-init runcmd steps (npm install, apt-get) can produce zero serial
        // console output for 60-130s, so 30s was too aggressive (false positives).
        const lines = log.split("\n").filter(Boolean).length;
        if (lines > 10 && lines === lastLineCount) {
          stallCount++;
          if (stallCount >= 60) {
            logger.warn(`[VmManager] VM ${domainName} console stalled at ${lines} lines`);
            return false;
          }
        } else {
          stallCount = 0;
          lastLineCount = lines;
        }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  }

  async ensureKsm(): Promise<void> {
    // KSM deduplicates identical memory pages across VMs sharing the same base image.
    // Burst phase: aggressive scan (5000 pages/pass, 10ms sleep) right after VM deploy.
    // After 60s, switch to conservative (256 pages/pass, 200ms sleep) to save CPU.
    const burstCmds = [
      "echo 1 > /sys/kernel/mm/ksm/run",
      "echo 1 > /sys/kernel/mm/ksm/merge_across_nodes",
      "echo 5000 > /sys/kernel/mm/ksm/pages_to_scan",
      "echo 10 > /sys/kernel/mm/ksm/sleep_millisecs",
    ];
    for (const cmd of burstCmds) {
      try {
        this.execSyncFn(`sudo sh -c '${cmd}'`, { stdio: "ignore" });
      } catch {
        // KSM not available on this kernel — non-fatal
      }
    }

    // Log current dedup stats for monitoring
    try {
      const shared = this.execSyncFn("cat /sys/kernel/mm/ksm/pages_shared", { encoding: "utf-8", stdio: "pipe" }) as string;
      const sharing = this.execSyncFn("cat /sys/kernel/mm/ksm/pages_sharing", { encoding: "utf-8", stdio: "pipe" }) as string;
      const savedKb = (parseInt(sharing) - parseInt(shared)) * 4;
      logger.info(`[KSM] pages_shared=${shared.trim()} pages_sharing=${sharing.trim()} saved=${savedKb}KB`);
    } catch {
      // stats unavailable — non-fatal
    }

    // After 60s, switch to conservative scan to reduce CPU overhead
    setTimeout(() => {
      try {
        this.execSyncFn("sudo sh -c 'echo 256 > /sys/kernel/mm/ksm/pages_to_scan'", { stdio: "ignore" });
        this.execSyncFn("sudo sh -c 'echo 200 > /sys/kernel/mm/ksm/sleep_millisecs'", { stdio: "ignore" });
        logger.info("[KSM] Switched to conservative scan (256 pages, 200ms sleep)");
      } catch {
        // ignore — KSM may have been disabled
      }
    }, 60_000);
  }

  private buildDomainXml(name: string, diskPath: string, isoPath: string, spec: VmSpec, userId: number, dataDiskPath: string): string {
    const mac = generateMacForUser(userId);
    return `<domain type="kvm">
  <name>${name}</name>
    <maxMemory slots="16" unit="MiB">${spec.ramMb}</maxMemory>
    <memory unit="MiB">${Math.max(1024, spec.ramMb - 1024)}</memory>
  <vcpu>${spec.vcpus}</vcpu>
  <os><type arch="x86_64">hvm</type></os>
  <cpu mode="host-passthrough"/>
  <devices>
    <disk type="file" device="disk">
      <driver name="qemu" type="qcow2"/>
      <source file="${diskPath}"/>
      <target dev="vda"/>
    </disk>
    <disk type="file" device="disk">
      <driver name="qemu" type="qcow2"/>
      <source file="${dataDiskPath}"/>
      <target dev="vdb"/>
    </disk>
    <disk type="file" device="cdrom">
      <source file="${isoPath}"/>
      <target dev="hda"/>
    </disk>
    <interface type="network">
      <mac address="${mac}"/>
      <source network="${VM_DEFAULTS.networkName}"/>
      <model type="virtio"/>
    </interface>
    <serial type="pty">
      <log file="/var/log/libvirt/qemu/${name}-console.log" append="off"/>
    </serial>
    <console type="pty">
      <log file="/var/log/libvirt/qemu/${name}-console.log" append="on"/>
    </console>
  </devices>
</domain>`;
  }

  async stop(userId: number): Promise<VmOperationResult> {
    const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
    try {
      this.execSyncFn(`sudo virsh shutdown ${domainName} --mode acpi`, {
        timeout: VM_DEFAULTS.shutdownTimeoutMs,
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // (2026-07-02): NEVER force-destroy (virsh destroy --graceful).
      // Graceful shutdown failed — fire alarm and return the error.
      // User data on the VM must be preserved.
      fireVmAlarmBg({
        severity: "WARN",
        userId,
        domainName,
        reason: `Graceful shutdown (virsh shutdown --mode acpi) failed: ${message}. Force-destroy BLOCKED to protect user data.`,
        blockedAction: `virsh destroy ${domainName} --graceful`,
        caller: "VmManager.stop",
        source: "manager.ts:425-434",
        timestamp: new Date().toISOString(),
      });
      return { success: false, error: `Graceful shutdown failed: ${message}. Admin notified.` };
    }
  }

  /** (2026-07-02) DESTROY IS NOW SAFE — never undefines domain or deletes disks.
   *  Only stops the VM gracefully. Admin alarm is fired with full context.
   *  User data (qcow2, data disk, domain XML) is preserved. */
  async destroy(userId: number): Promise<VmOperationResult> {
    const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
    const clonePath = path.join(VM_DEFAULTS.imagesDir, `${domainName}.qcow2`);

    // Fire CRITICAL alarm — someone tried to destroy a user VM
    fireVmAlarmBg({
      severity: "CRITICAL",
      userId,
      domainName,
      reason: `destroy() called — would have undefine'd domain and deleted OS disk ${clonePath}. User data preserved.`,
      blockedAction: `virsh undefine ${domainName} + unlink ${clonePath} + DHCP cleanup`,
      caller: "VmManager.destroy",
      source: "manager.ts:436-469",
      timestamp: new Date().toISOString(),
    });

    // Only graceful stop — NO undefine, NO disk deletion
    const stopResult = await this.stop(userId);
    if (!stopResult.success) {
      return stopResult;
    }

    logger.warn("[VmManager] destroy() called for userId=%d — domain preserved, admin notified", userId);
    return { success: true };
  }

  async isRunning(userId: number): Promise<boolean> {
    const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
    try {
      const output = this.execSyncFn(`sudo virsh domstate ${domainName}`, {
        encoding: "utf-8",
      }) as string;
      return output.trim() === "running";
    } catch {
      return false;
    }
  }

  /** Attempt to start an existing (but stopped) VM domain.
   *  Returns true if the domain was started successfully. */
  async startDomain(userId: number): Promise<boolean> {
    const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
    try {
      this.execSyncFn(`sudo virsh start ${domainName}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  /** Check if a libvirt domain is defined (exists) for the given userId.
   *  Returns false only when domain is completely undefined — not just shut off. */
  domainExists(domainName: string): boolean {
    try {
      this.execSyncFn(`sudo virsh dominfo ${domainName}`, {
        stdio: "pipe",
        encoding: "utf-8",
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Get the current state of a libvirt domain (running, shut off, etc.).
   *  Returns "unknown" if the domain does not exist or domstate fails. */
  domainState(domainName: string): string {
    try {
      const output = this.execSyncFn(`sudo virsh domstate ${domainName}`, {
        encoding: "utf-8",
      }) as string;
      return output.trim() || "unknown";
    } catch {
      return "unknown";
    }
  }

  /** Update a VM to match current golden image configuration.
   *  SSH-only for running VMs, guestfish for stopped VMs.
   *  Does NOT recreate the overlay — all user data is preserved. */
  async updateVm(userId: number): Promise<{
    success: boolean;
    error?: string;
    method?: "ssh" | "guestfish" | "skipped";
    versionBefore?: string | null;
    versionAfter?: string | null;
  }> {
    const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
    const qcow2Path = path.join(VM_DEFAULTS.imagesDir, `${domainName}.qcow2`);

    // Check if VM definition exists via virsh dominfo
    try {
      this.execSyncFn(`sudo virsh dominfo ${domainName}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      return { success: false, error: "VM not found" };
    }

    // Read current golden version before update
    const versionBefore = await readGoldenVersion(qcow2Path);

    // Check if VM is running via virsh list --name
    let running = false;
    try {
      const listOutput = this.execSyncFn(`sudo virsh list --name`, {
        encoding: "utf-8",
        stdio: "pipe",
      }) as string;
      running = listOutput.split("\n").some(line => line.trim() === domainName);
    } catch {
      running = false;
    }

    const tier = getUserVmSpecTier(userId) ?? "medium";
    const password = derivePassword(userId, tier);

    if (running) {
      // SSH is the ONLY path for running VMs — guestfish can't modify a live disk
      const bridgeIp = await this.getBridgeIp(userId);
      if (!bridgeIp) {
        const versionAfter = await readGoldenVersion(qcow2Path);
        return { success: false, method: "ssh", error: "Cannot determine VM IP address", versionBefore, versionAfter };
      }

      // Read source files for deployment
      let payload: FullUpdatePayload;
      try {
        payload = readUpdatePayload();
      } catch (err) {
        const versionAfter = await readGoldenVersion(qcow2Path);
        return { success: false, method: "ssh", error: `Failed to read update payload: ${err instanceof Error ? err.message : String(err)}`, versionBefore, versionAfter };
      }

      const sshResult = await deployFullUpdate(bridgeIp, password, payload, { timeout: 120000 });
      const versionAfter = await readGoldenVersion(qcow2Path);
      return { success: sshResult.success, method: "ssh", error: sshResult.error, versionBefore, versionAfter };
    }

    // VM is not running — guestfish directly
    const gfResult = await injectViaGuestfish(qcow2Path, [...DEFAULT_GUESTFISH_FIXES]);
    if (!gfResult.success) {
      const versionAfter = await readGoldenVersion(qcow2Path);
      return {
        success: false,
        method: "guestfish",
        error: `guestfish: ${gfResult.error}`,
        versionBefore,
        versionAfter,
      };
    }

    const versionAfter = await readGoldenVersion(qcow2Path);
    return { success: true, method: "guestfish", versionBefore, versionAfter };
  }

  async waitForHealth(
    baseUrl: string,
    password: string,
    timeoutMs: number,
    pollMs?: number,
  ): Promise<boolean> {
    const pollInterval = pollMs ?? VM_DEFAULTS.healthPollMs;
    const healthUrl = `${baseUrl}/api/health`;
    const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(healthUrl, {
          headers: { Authorization: authHeader },
        });
        if (res.ok) return true;
      } catch {
        logger.debug("[VmManager] Health check failed, retrying...");
      }
      await sleep(pollInterval);
    }

    return false;
  }

  async getBridgeIp(userId: number, retryDelayMs?: number): Promise<string | null> {
    const deterministicIp = generateIpForUser(userId);

    // Method 0: deterministic IP — we reserved a static DHCP host entry,
    // so the VM will get this IP. Static reservations don't appear in
    // virsh domifaddr --source lease or net-dhcp-leases, so we just return
    // the deterministic IP. Health check (waitForHealth) confirms reachability.
    return deterministicIp;
  }

  private getDomainMac(domainName: string): string | null {
    try {
      const xml = this.execSyncFn(
        `sudo virsh dumpxml ${domainName}`,
        { encoding: "utf-8" },
      ) as string;
      const macMatch = xml.match(/mac address='([^']+)'/i);
      return macMatch ? macMatch[1] : null;
    } catch {
      return null;
    }
  }

  async provision(userId: number, spec: VmSpec): Promise<VmHandle> {
    const info = await this.createAndStart(userId, spec);
    const vmId = randomUUID();
    return this.toVmHandle(vmId, info);
  }

   async attach(existing: VmStateRecord): Promise<VmHandle | null> {
    const running = await this.isRunning(existing.userId);
    if (!running) return null;
    return {
      vmId: existing.vmId,
      userId: existing.userId,
      domainName: existing.domainName,
      ipv4: existing.assignedIpv4,
      mac: existing.assignedMac,
      baseUrl: `http://${existing.assignedIpv4}:${VM_DEFAULTS.opencodePort}`,
      password: getOrCreateServerPassword(existing.userId),
      specTier: existing.specTier,
    };
  }

  async healthCheck(handle: VmHandle, options?: { timeoutMs?: number; pollMs?: number }): Promise<HealthStatus> {
    const proxy = createLibvirtHealthProxy({ timeoutMs: options?.timeoutMs, pollMs: options?.pollMs });
    return proxy.check(handle);
  }

  async destroyHandle(handle: VmHandle): Promise<VmOperationResult> {
    return this.destroy(handle.userId);
  }

  /** Resolve golden image virtual size in GiB from qemu-img info output.
   *  Used to set OS overlay size — minimal, just enough for OS + deps. */
  private resolveBaseImageSizeGb(baseImagePath: string): number {
    try {
      const info = this.execSyncFn(`qemu-img info --output=json "${baseImagePath}"`, {
        encoding: "utf-8",
      });
      const parsed = JSON.parse(info);
      const bytes = parsed["virtual-size"];
      if (typeof bytes === "number") {
        return Math.ceil(bytes / (1024 ** 3));
      }
    } catch {
      logger.warn("[VmManager] Could not resolve base image size, defaulting to 20 GB");
    }
    return 20; // fallback
  }

  private toVmHandle(vmId: string, info: VmInfo): VmHandle {
    return {
      vmId,
      userId: info.userId,
      domainName: info.domainName,
      ipv4: info.bridgeIp ?? "",
      mac: generateMacForUser(info.userId),
      baseUrl: info.baseUrl,
      password: info.serverPassword ?? info.sudoPassword ?? "",
      specTier: info.tier,
    };
  }

}

/** Read MCP server files and tg-agent.md for deployment to VMs.
 *  Resolves paths relative to the module URL (works with ESM bundlers). */
function readUpdatePayload(): FullUpdatePayload {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const tgAgentMd = readFileSync(resolve(__dirname, "tg-agent-content.md"), "utf-8");
  const memoryServerTs = readFileSync(resolve(__dirname, "mcp-servers/memory-ts/server.ts"), "utf-8");
  const memoryStoreTs = readFileSync(resolve(__dirname, "mcp-servers/memory-ts/memory_store.ts"), "utf-8");
  const skillsServerTs = readFileSync(resolve(__dirname, "mcp-servers/skills-ts/server.ts"), "utf-8");

  return { tgAgentMd, memoryServerTs, memoryStoreTs, skillsServerTs };
}

export const vmManager = new VmManager();
