import { randomBytes } from "crypto";
import { execSync as nodeExecSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { VM_DEFAULTS, type VmSpec } from "./types.js";

type ExecSyncFn = typeof nodeExecSync;
type WriteFileSyncFn = typeof writeFileSync;
type MkdirSyncFn = typeof mkdirSync;

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
  const hashedSudoPw = hashPassword(sudoPassword, execSyncFn);

  const userData = `#cloud-config
hostname: ${hostname}
manage_etc_hosts: true
users:
  - name: opencode
    gecos: OpenCode User
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    passwd: ${hashedSudoPw}
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
  - |
    ip -6 addr add ${ipv6 ?? "::1"}/128 dev eth0 2>/dev/null || true
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
  - echo "${sudoPassword}" > /home/opencode/.sudo
  - chown opencode:opencode /home/opencode/.sudo
  - chmod 600 /home/opencode/.sudo
  - chown -R opencode:opencode /workspace /state
  - rm -f /etc/machine-id /var/lib/dbus/machine-id && systemd-machine-id-setup
  # Install Node.js if not in golden image
  - command -v node 2>/dev/null || (apt-get update -qq && apt-get install -y -qq nodejs npm) || echo 'nodejs install failed'
  # Install OpenCode CLI
  - command -v opencode 2>/dev/null || npm install -g --force opencode-ai@1.15.13 || echo 'v1 opencode install failed'
  # Install node-pty for interactive terminal (skip failure — terminal won't work but bot still functional)
  - node -e 'require("node-pty")' 2>/dev/null || npm install -g node-pty 2>/dev/null || echo 'node-pty install failed'
  - rm -f /home/opencode/.local/share/opencode/opencode.db /home/opencode/.local/share/opencode/opencode.db-wal /home/opencode/.local/share/opencode/opencode.db-shm
  # Copy pre-baked skills from golden image (handle both flat and nested /opt/opencode-skills)
  - mkdir -p /home/opencode/.config/opencode/skills && for src in /opt/opencode-skills.flat /opt/opencode-skills /opt/opencode-skills/skills; do test -d "$src" && [ "$(ls -A "$src" 2>/dev/null)" ] && cp -r "$src"/* /home/opencode/.config/opencode/skills/ 2>/dev/null && break; done; chown -R opencode:opencode /home/opencode/.config/opencode 2>/dev/null || true
  # Copy terminal-agent if not already present
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
