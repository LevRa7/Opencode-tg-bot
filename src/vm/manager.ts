import { execSync as nodeExecSync } from "child_process";
import { existsSync, unlinkSync, writeFileSync as fsWriteFileSync, mkdirSync as fsMkdirSync } from "fs";
import path from "path";
import { logger } from "../utils/logger.js";
import { VM_DEFAULTS, type VmInfo, type VmOperationResult, type VmSpec } from "./types.js";
import { generateSudoPassword, generateCloudInitIso } from "./cloud-init.js";
import { getOrCreateServerPassword } from "../settings/manager.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VmManager {
  private execSyncFn: typeof nodeExecSync;

  constructor(execSyncFn?: typeof nodeExecSync) {
    this.execSyncFn = execSyncFn ?? nodeExecSync;
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
    try {
      const check = this.execSyncFn(`sudo virsh net-info ${netName}`, {
        stdio: "pipe",
        encoding: "utf-8",
      }) as string;
      if (check.includes("Active:") && check.includes("yes")) {
        return { success: true };
      }
      this.execSyncFn(`sudo virsh net-start ${netName}`, { stdio: "pipe" });
      this.execSyncFn(`sudo virsh net-autostart ${netName}`, { stdio: "ignore" });
      logger.info(`[VmManager] Network ${netName} started`);
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
      return { success: true };
    }
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
    const sudoPw = deps?.sudoPassword ?? generateSudoPassword();
    const write = deps?.writeFileSync ?? fsWriteFileSync;
    const mkdir = deps?.mkdirSync ?? fsMkdirSync;

    const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
    const baseImage = path.join(VM_DEFAULTS.imagesDir, VM_DEFAULTS.baseImageName);
    const clonePath = path.join(VM_DEFAULTS.imagesDir, `${domainName}.qcow2`);
    const isoPath = path.join(VM_DEFAULTS.imagesDir, `cloud-init-${userId}.iso`);
    const xmlPath = path.join(VM_DEFAULTS.imagesDir, `${domainName}.xml`);

    report("🔐 Настройка доступа...");
    try {
      this.execSyncFn(`sudo setfacl -m u:libvirt-qemu:x ${path.dirname(VM_DEFAULTS.imagesDir)}`, { stdio: "ignore" });
      this.execSyncFn(`sudo setfacl -m u:libvirt-qemu:x ${VM_DEFAULTS.imagesDir}`, { stdio: "ignore" });
    } catch { /* non-fatal — may already be set */ }

    report("🌐 Настройка сети...");
    await this.ensureNetwork();

    // Clean up any leftover from previous attempt before creating new
    report("🧹 Очистка предыдущей VM...");
    try {
      this.execSyncFn(`sudo virsh destroy ${domainName} --graceful`, { stdio: "ignore" });
    } catch { /* not running — ok */ }
    try {
      this.execSyncFn(`sudo virsh undefine ${domainName}`, { stdio: "ignore" });
    } catch { /* not defined — ok */ }
    try {
      this.execSyncFn(`sudo rm -f ${clonePath}`, { stdio: "ignore" });
    } catch { /* file didn't exist — ok */ }
    try {
      this.execSyncFn(`sudo rm -f ${isoPath}`, { stdio: "ignore" });
    } catch { /* file didn't exist — ok */ }

    report("📦 Клонирование образа...");
    this.execSyncFn(
      `sudo qemu-img create -f qcow2 -b ${baseImage} -F qcow2 ${clonePath} ${spec.diskGb}G`,
      { stdio: "ignore" },
    );

    report("⚙️ Генерация cloud-init...");
    generateCloudInitIso(userId, spec, opencodePw, sudoPw, isoPath, this.execSyncFn, write, mkdir);

    const domainXml = this.buildDomainXml(domainName, clonePath, isoPath, spec);
    write(xmlPath, domainXml);

    report("🖥 Определение VM...");
    this.execSyncFn(`sudo virsh define ${xmlPath}`, { stdio: "pipe" });

    report("🚀 Запуск VM...");
    this.execSyncFn(`sudo virsh start ${domainName}`, { stdio: "pipe" });

    report("🌐 Ожидание IP (DHCP)...");
    const bridgeIp = await this.getBridgeIp(userId, deps?.dhcpRetryDelayMs);
    if (!bridgeIp) {
      throw new Error(`VM started but DHCP lease not obtained within ${((VM_DEFAULTS.dhcpRetries * VM_DEFAULTS.dhcpRetryDelayMs) / 1000).toFixed(0)}s`);
    }
    const host = bridgeIp;

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
    };
  }

  private buildDomainXml(name: string, diskPath: string, isoPath: string, spec: VmSpec): string {
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
    <disk type="file" device="cdrom">
      <source file="${isoPath}"/>
      <target dev="hda"/>
    </disk>
    <interface type="network">
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
    } catch {
      try {
        this.execSyncFn(`sudo virsh destroy ${domainName} --graceful`, {
          timeout: VM_DEFAULTS.forceDestroyTimeoutMs,
        });
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    }
  }

  async destroy(userId: number): Promise<VmOperationResult> {
    const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;

    const stopResult = await this.stop(userId);
    if (!stopResult.success) {
      return stopResult;
    }

    try {
      this.execSyncFn(`sudo virsh undefine ${domainName} --remove-all-storage`, {
        stdio: "ignore",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }

    try {
      const isoPath = path.join(VM_DEFAULTS.imagesDir, `cloud-init-${userId}.iso`);
      unlinkSync(isoPath);
    } catch {
      logger.warn(`[VmManager] Could not remove cloud-init ISO for userId=${userId}`);
    }

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
    const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
    const netName = VM_DEFAULTS.networkName;
    const delay = retryDelayMs ?? VM_DEFAULTS.dhcpRetryDelayMs;
    const ipRegex = /\d+\.\d+\.\d+\.\d+/;
    const knownMac = this.getDomainMac(domainName);

    for (let attempt = 0; attempt < VM_DEFAULTS.dhcpRetries; attempt++) {
      try {
        // Method 1: virsh net-dhcp-leases (works without guest agent)
        const leases = this.execSyncFn(
          `sudo virsh net-dhcp-leases ${netName}`,
          { encoding: "utf-8" },
        ) as string;
        const match = leases.match(ipRegex);
        if (match) {
          const ip = match[0];
          // Verify this lease belongs to our domain's MAC (if possible)
          if (!knownMac || leases.includes(knownMac.toLowerCase())) {
            return ip;
          }
          // If we can't verify MAC but there is a lease, use it
          return ip;
        }
      } catch {
        logger.debug(`[VmManager] net-dhcp-leases attempt ${attempt + 1} failed`);
      }

      try {
        // Method 2: virsh domifaddr --source lease (fallback)
        const output = this.execSyncFn(
          `sudo virsh domifaddr ${domainName} --source lease`,
          { encoding: "utf-8" },
        ) as string;
        const match = output.match(ipRegex);
        if (match) return match[0];
      } catch {
        // lease source may not be available
      }

      try {
        // Method 3: virsh domifaddr --source agent (requires qemu-guest-agent)
        const output = this.execSyncFn(
          `sudo virsh domifaddr ${domainName} --source agent`,
          { encoding: "utf-8" },
        ) as string;
        const match = output.match(ipRegex);
        if (match) return match[0];
      } catch {
        // guest agent not available — expected during first boot
      }

      if (attempt < VM_DEFAULTS.dhcpRetries - 1) {
        await sleep(delay);
      }
    }

    return null;
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
}

export const vmManager = new VmManager();
