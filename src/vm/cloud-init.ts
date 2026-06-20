import { randomBytes } from "crypto";
import { execSync as nodeExecSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { VM_DEFAULTS, type VmSpec } from "./types.js";

type ExecSyncFn = typeof nodeExecSync;
type WriteFileSyncFn = typeof writeFileSync;
type MkdirSyncFn = typeof mkdirSync;

export interface CloudInitContext {
  userId: number;
  opencodePassword: string;
  sudoPassword: string;
  ipv6?: string;
}

/** @deprecated Use derivePassword(userId, specTier) from types.ts instead */
export function generateSudoPassword(): string {
  return randomBytes(12).toString("base64url").slice(0, 16);
}

export function hashPassword(
  password: string,
  execSyncFn?: ExecSyncFn,
): string {
  const exec = execSyncFn ?? nodeExecSync;
  return exec(`mkpasswd -m sha-512 -- "${password}"`, {
    encoding: "utf-8",
  }).trim();
}

/** Phase 1: infrastructure setup — hostname, network, boot config.
 *  Does NOT include user secrets (password, env vars). */
export function generateInfrastructureIso(
  hostname: string,
  ipv6: string | undefined,
  outputPath: string,
  execSyncFn?: ExecSyncFn,
  writeFn?: WriteFileSyncFn,
  mkdirFn?: MkdirSyncFn,
): void {
  const exec = execSyncFn ?? nodeExecSync;
  const write = writeFn ?? writeFileSync;
  const mkdir = mkdirFn ?? mkdirSync;

  const userData = `#cloud-config
hostname: ${hostname}
manage_etc_hosts: true
bootcmd:
  - |
    mkdir -p /etc/systemd/network /workspace /state/skills /etc/opencode
    cat > /etc/systemd/network/50-dhcp.network <<NETEOF
    [Match]
    Name=en*
    [Network]
    DHCP=yes
    NETEOF
    networkctl reload 2>/dev/null || true
runcmd:
  - IFACE=$(ip -o link show | grep -o "e[mn][a-z0-9]*" | head -1) && ip -6 addr add ${ipv6 ?? "::1"}/128 dev \$IFACE 2>/dev/null || true
  - IFACE=$(ip -o link show | grep -o "e[mn][a-z0-9]*" | head -1) && sysctl -w net.ipv6.conf.\${IFACE}.ndisc_notify=1 2>/dev/null || true
  - IFACE=$(ip -o link show | grep -o "e[mn][a-z0-9]*" | head -1) && ip -6 route replace default via fe80::1 dev \$IFACE 2>/dev/null || true
  - rm -f /etc/machine-id /var/lib/dbus/machine-id && systemd-machine-id-setup
  - command -v node 2>/dev/null || (apt-get update -qq && apt-get install -y -qq nodejs npm) || echo 'nodejs install failed'
  - command -v opencode 2>/dev/null || npm install -g --force opencode-ai@1.15.13 || echo 'v1 opencode install failed'
  - node -e 'require("node-pty")' 2>/dev/null || npm install -g node-pty 2>/dev/null || echo 'node-pty install failed'
  - rm -f /home/opencode/.local/share/opencode/opencode.db /home/opencode/.local/share/opencode/opencode.db-wal /home/opencode/.local/share/opencode/opencode.db-shm
  - mkdir -p /home/opencode/.config/opencode/skills && for src in /opt/opencode-skills.flat /opt/opencode-skills /opt/opencode-skills/skills; do test -d "$src" && [ "$(ls -A "$src" 2>/dev/null)" ] && cp -r "$src"/* /home/opencode/.config/opencode/skills/ 2>/dev/null && break; done; chown -R opencode:opencode /home/opencode/.config/opencode 2>/dev/null || true
  - test -f /opt/terminal-agent.js && chmod +x /opt/terminal-agent.js || true
`;

  const metaData = `instance-id: ${hostname}
local-hostname: ${hostname}
`;

  const networkConfig = `version: 2
ethernets:
  auto:
    match:
      driver: virtio_net
    dhcp4: true
    dhcp6: false
`;

  const tmpDir = path.dirname(outputPath);
  mkdir(tmpDir, { recursive: true });

  const userDataFile = path.join(tmpDir, "user-data");
  const metaDataFile = path.join(tmpDir, "meta-data");
  const networkConfigFile = path.join(tmpDir, "network-config");

  write(userDataFile, userData);
  write(metaDataFile, metaData);
  write(networkConfigFile, networkConfig);

  exec(
    `cloud-localds --network-config "${networkConfigFile}" "${outputPath}" "${userDataFile}" "${metaDataFile}"`,
    { stdio: "ignore" },
  );
}

/** Phase 2: load context — user-specific secrets and service config. */
export function generateContextIso(
  ctx: CloudInitContext,
  outputPath: string,
  execSyncFn?: ExecSyncFn,
  writeFn?: WriteFileSyncFn,
  mkdirFn?: MkdirSyncFn,
): void {
  const exec = execSyncFn ?? nodeExecSync;
  const write = writeFn ?? writeFileSync;
  const mkdir = mkdirFn ?? mkdirSync;
  const hostname = `${VM_DEFAULTS.domainNamePrefix}-${ctx.userId}`;

  // WRITE_FILES are applied by cloud-init during FIRST boot only.
  // Context ISO is mounted as a secondary cdrom — cloud-init picks up
  // write_files from any partition if it's the first boot.
  const userData = `#cloud-config
users:
  - name: opencode
    gecos: OpenCode User
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    passwd: ${hashPassword(ctx.sudoPassword, execSyncFn)}
ssh_pwauth: true
write_files:
  - path: /workspace/AGENTS.md
    content: |
      # AGENTS.md
      ## Sudo access
      For system operations requiring sudo, read the password from \`/home/opencode/.sudo\`.
      Example: \`cat /home/opencode/.sudo | sudo -S <command>\`
    permissions: '0644'
  - path: /etc/opencode/env
    content: |
      OPENCODE_SERVER_PASSWORD=${ctx.opencodePassword}
      TG_ID=${ctx.userId}
    permissions: '0600'
  - path: /etc/systemd/system/opencode.service
    content: |
      [Unit]
      Description=OpenCode Server
      After=network-online.target
      [Service]
      Type=simple
      ExecStart=/usr/local/bin/opencode serve --hostname 0.0.0.0 --port 4096
      EnvironmentFile=/etc/opencode/env
      Restart=always
      RestartSec=5
      User=opencode
      Group=opencode
      WorkingDirectory=/workspace
      [Install]
      WantedBy=multi-user.target
    permissions: '0644'
runcmd:
  - echo "${ctx.sudoPassword}" > /home/opencode/.sudo
  - chown opencode:opencode /home/opencode/.sudo
  - chmod 600 /home/opencode/.sudo
  - chown -R opencode:opencode /workspace /state
  - systemctl daemon-reload
  - systemctl enable opencode
  - systemctl restart opencode || systemctl start opencode
`;

  const metaData = `instance-id: ${hostname}
local-hostname: ${hostname}
`;

  const tmpDir = path.dirname(outputPath);
  mkdir(tmpDir, { recursive: true });

  write(path.join(tmpDir, "user-data"), userData);
  write(path.join(tmpDir, "meta-data"), metaData);

  exec(
    `cloud-localds "${outputPath}" "${path.join(tmpDir, "user-data")}" "${path.join(tmpDir, "meta-data")}"`,
    { stdio: "ignore" },
  );
}

// Backward-compatible merged generator
export function generateCloudInitIso(
  userId: number,
  spec: VmSpec,
  opencodePassword: string,
  sudoPassword: string,
  outputPath: string,
  execSyncFn?: ExecSyncFn,
  writeFn?: WriteFileSyncFn,
  mkdirFn?: MkdirSyncFn,
  ipv6?: string,
): void {
  const exec = execSyncFn ?? nodeExecSync;
  const write = writeFn ?? writeFileSync;
  const mkdir = mkdirFn ?? mkdirSync;
  const hostname = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;

  // Single merged ISO (original behavior)
  const userData = `#cloud-config
hostname: ${hostname}
manage_etc_hosts: true
users:
  - name: opencode
    gecos: OpenCode User
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    passwd: ${hashPassword(sudoPassword, execSyncFn)}
ssh_pwauth: true
bootcmd:
  - |
    mkdir -p /etc/systemd/network /workspace /state/skills /etc/opencode
    cat > /etc/systemd/network/50-dhcp.network <<NETEOF
    [Match]
    Name=en*
    [Network]
    DHCP=yes
    NETEOF
    networkctl reload 2>/dev/null || true
write_files:
  - path: /workspace/AGENTS.md
    content: |
      # AGENTS.md
      ## Sudo access
      For system operations requiring sudo, read the password from \`/home/opencode/.sudo\`.
      Example: \`cat /home/opencode/.sudo | sudo -S <command>\`
    permissions: '0644'
  - path: /etc/opencode/env
    content: |
      OPENCODE_SERVER_PASSWORD=${opencodePassword}
      TG_ID=${userId}
    permissions: '0600'
  - path: /etc/systemd/system/opencode.service
    content: |
      [Unit]
      Description=OpenCode Server
      After=network-online.target
      [Service]
      Type=simple
      ExecStart=/usr/local/bin/opencode serve --hostname 0.0.0.0 --port 4096
      EnvironmentFile=/etc/opencode/env
      Restart=always
      RestartSec=5
      User=opencode
      Group=opencode
      WorkingDirectory=/workspace
      [Install]
      WantedBy=multi-user.target
    permissions: '0644'
runcmd:
  - IFACE=$(ip -o link show | grep -o "e[mn][a-z0-9]*" | head -1) && ip -6 addr add ${ipv6 ?? "::1"}/128 dev \$IFACE 2>/dev/null || true
  - IFACE=$(ip -o link show | grep -o "e[mn][a-z0-9]*" | head -1) && sysctl -w net.ipv6.conf.\${IFACE}.ndisc_notify=1 2>/dev/null || true
  - IFACE=$(ip -o link show | grep -o "e[mn][a-z0-9]*" | head -1) && ip -6 route replace default via fe80::1 dev \$IFACE 2>/dev/null || true
  - echo "${sudoPassword}" > /home/opencode/.sudo
  - chown opencode:opencode /home/opencode/.sudo
  - chmod 600 /home/opencode/.sudo
  - chown -R opencode:opencode /workspace /state
  - rm -f /etc/machine-id /var/lib/dbus/machine-id && systemd-machine-id-setup
  - command -v node 2>/dev/null || (apt-get update -qq && apt-get install -y -qq nodejs npm) || echo 'nodejs install failed'
  - command -v opencode 2>/dev/null || npm install -g --force opencode-ai@1.15.13 || echo 'v1 opencode install failed'
  - node -e 'require("node-pty")' 2>/dev/null || npm install -g node-pty 2>/dev/null || echo 'node-pty install failed'
  - rm -f /home/opencode/.local/share/opencode/opencode.db /home/opencode/.local/share/opencode/opencode.db-wal /home/opencode/.local/share/opencode/opencode.db-shm
  - mkdir -p /home/opencode/.config/opencode/skills && for src in /opt/opencode-skills.flat /opt/opencode-skills /opt/opencode-skills/skills; do test -d "$src" && [ "$(ls -A "$src" 2>/dev/null)" ] && cp -r "$src"/* /home/opencode/.config/opencode/skills/ 2>/dev/null && break; done; chown -R opencode:opencode /home/opencode/.config/opencode 2>/dev/null || true
  - test -f /opt/terminal-agent.js && chmod +x /opt/terminal-agent.js || true
  - systemctl daemon-reload
  - systemctl enable opencode
  - systemctl restart opencode || systemctl start opencode
`;

  const metaData = `instance-id: opencode-tg-${userId}
local-hostname: ${hostname}
`;

  const networkConfig = `version: 2
ethernets:
  auto:
    match:
      driver: virtio_net
    dhcp4: true
    dhcp6: false
`;

  const tmpDir = path.dirname(outputPath);
  mkdir(tmpDir, { recursive: true });

  write(path.join(tmpDir, "user-data"), userData);
  write(path.join(tmpDir, "meta-data"), metaData);
  write(path.join(tmpDir, "network-config"), networkConfig);

  exec(
    `cloud-localds --network-config "${path.join(tmpDir, "network-config")}" "${outputPath}" "${path.join(tmpDir, "user-data")}" "${path.join(tmpDir, "meta-data")}"`,
    { stdio: "ignore" },
  );
}
