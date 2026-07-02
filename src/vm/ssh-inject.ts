import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// DEFAULT_SSH_FIXES — online SSH fixes for running VMs
// ---------------------------------------------------------------------------
// Mirror the cloud-init / guestfish SSH fix pattern.
// 1. sed to enable PasswordAuthentication (match indented lines with [[:space:]]*)
// 2. Restart sshd so the config change takes effect
// 3. Symlink workspace skills so the agent can pick up user-provided skills
//
// NOTE: SSH can restart sshd because we are still connected AND
// PasswordAuthentication gets fixed BEFORE the restart.

export const DEFAULT_SSH_FIXES = [
  `sed -i 's/^[[:space:]]*PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config`,
  `systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true`,
  `mkdir -p /workspace/skills && rm -rf /home/opencode/.config/opencode/skills/user && ln -sfT /workspace/skills /home/opencode/.config/opencode/skills/user`,
] as const;

// ---------------------------------------------------------------------------
// injectViaSsh — online SSH injection for running VMs
// ---------------------------------------------------------------------------

export async function injectViaSsh(
  host: string,
  password: string,
  commands: readonly string[],
  options?: { port?: number; user?: string; timeout?: number; useSudo?: boolean },
): Promise<{ success: boolean; error?: string; command?: string }> {
  const port = options?.port ?? 22;
  const user = options?.user ?? "opencode";
  const timeout = options?.timeout ?? 15000;
  const useSudo = options?.useSudo ?? false;

  const sudoPrefix = useSudo ? `echo '${password}' | sudo -S ` : "";

  for (const command of commands) {
    const quoted = command.replace(/'/g, "'\\''");
    const cmd = [
      "sshpass",
      "-p",
      password,
      "ssh",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "ConnectTimeout=5",
      "-p",
      String(port),
      `${user}@${host}`,
      `"${sudoPrefix}bash -c '${quoted}'"`,
    ].join(" ");

    try {
      await execAsync(cmd, { timeout });
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        command,
      };
    }
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// SSH file deployment helpers
// ---------------------------------------------------------------------------

interface SshFile {
  remotePath: string;
  content: string;
  permissions?: string;
  owner?: string;
}

/**
 * Deploy files to a VM via scp + ssh.
 * Writes temp files, scp's them, sets permissions, cleans up.
 */
export async function deployFilesViaSsh(
  host: string,
  password: string,
  files: SshFile[],
  options?: { port?: number; user?: string; timeout?: number },
): Promise<{ success: boolean; error?: string }> {
  const port = options?.port ?? 22;
  const user = options?.user ?? "opencode";
  const timeout = options?.timeout ?? 30000;

  const tempDir = join(tmpdir(), `hermes-vm-update-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  const tempFiles: string[] = [];

  try {
    // Write all files to temp dir using hashed names (avoid path encoding issues)
    const fileMap = new Map<string, string>(); // tempName → remotePath
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const tempName = `file_${i}`;
      const tempPath = join(tempDir, tempName);
      writeFileSync(tempPath, file.content, { flag: "wx" });
      fileMap.set(tempName, file.remotePath);
      tempFiles.push(tempPath);
    }

    // SCP the temp dir to /tmp/ on the VM
    const scpCmd = [
      "sshpass",
      "-p",
      password,
      "scp",
      "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=5",
      "-P", String(port),
      "-r",
      tempDir,
      `${user}@${host}:/tmp/hermes-update-files`,
    ].join(" ");

    await execAsync(scpCmd, { timeout });

    // Move files into place with correct permissions via SSH
    for (const [tempName, remotePath] of fileMap) {
      const tempRemotePath = `/tmp/hermes-update-files/${tempName}`;
      const dir = remotePath.substring(0, remotePath.lastIndexOf("/"));
      const file = files.find(f => f.remotePath === remotePath)!;
      const moveCmd = [
        "sshpass", "-p", password,
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5",
        "-p", String(port), `${user}@${host}`,
        `"sudo mkdir -p ${dir} && sudo mv ${tempRemotePath} ${remotePath} && sudo chmod ${file.permissions ?? '644'} ${remotePath}${file.owner ? ` && sudo chown ${file.owner} ${remotePath}` : ''}"`,
      ].join(" ");

      await execAsync(moveCmd, { timeout: 10000 });
    }

    // Cleanup temp on VM
    await execAsync(
      `sshpass -p '${password}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -p ${String(port)} ${user}@${host} "sudo rm -rf /tmp/hermes-update-files"`,
      { timeout: 5000 },
    );

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Cleanup local temp files
    for (const tf of tempFiles) {
      try { unlinkSync(tf); } catch { /* best-effort */ }
    }
    // Also remove temp files that may have been written before error
    try {
      for (const file of files) {
        const tf = join(tempDir, encodeURIComponent(file.remotePath));
        if (existsSync(tf)) unlinkSync(tf);
      }
    } catch { /* best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// Full update: MCP deployment + tg-agent.md + config + permissions
// Applied via SSH when VM is running.
// ---------------------------------------------------------------------------

export const MCP_JSON_CONTENT = JSON.stringify({
  mcpServers: {
    memory: {
      command: "tsx",
      args: ["/opt/mcp-servers/memory-ts/server.ts"],
    },
    skills: {
      command: "tsx",
      args: ["/opt/mcp-servers/skills-ts/server.ts"],
    },
  },
}, null, 2);

export const FULL_UPDATE_SSH_COMMANDS = [
  // Enable password auth (idempotent)
  `sed -i 's/^[[:space:]]*PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config`,
  `systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true`,

  // Create directories
  `mkdir -p /opt/mcp-servers/memory-ts/__tests__ /opt/mcp-servers/skills-ts`,
  `mkdir -p /workspace/skills /home/opencode/.config/opencode/agents`,

  // Skills symlink
  `rm -rf /home/opencode/.config/opencode/skills/user && ln -sfT /workspace/skills /home/opencode/.config/opencode/skills/user`,

  // Install MCP SDK (idempotent — npm handles already-installed gracefully)
  `npm install -g @modelcontextprotocol/sdk tsx 2>&1 | tail -3 || echo 'npm install failed (non-fatal)'`,

  // Symlink node_modules for tsx
  `ln -sf /usr/lib/node_modules /opt/node_modules 2>/dev/null || true`,

  // Fix MCP server permissions
  `chmod -R 755 /opt/mcp-servers/ 2>/dev/null || true`,

  // Restart opencode (idempotent)
  `systemctl restart opencode 2>/dev/null || true`,
] as const;

export interface FullUpdatePayload {
  tgAgentMd: string;
  memoryServerTs: string;
  memoryStoreTs: string;
  skillsServerTs: string;
}

/**
 * Deploy a full update to a running VM: MCP servers, tg-agent.md, mcp.json,
 * SDK install, permissions fix, opencode restart.
 */
export async function deployFullUpdate(
  host: string,
  password: string,
  payload: FullUpdatePayload,
  options?: { port?: number; user?: string; timeout?: number },
): Promise<{ success: boolean; error?: string; method: string }> {
  // Phase 1: deploy files via scp
  const files: SshFile[] = [
    {
      remotePath: "/opt/mcp-servers/memory-ts/server.ts",
      content: payload.memoryServerTs,
      permissions: "755",
      owner: "root:root",
    },
    {
      remotePath: "/opt/mcp-servers/memory-ts/memory_store.ts",
      content: payload.memoryStoreTs,
      permissions: "644",
      owner: "root:root",
    },
    {
      remotePath: "/opt/mcp-servers/skills-ts/server.ts",
      content: payload.skillsServerTs,
      permissions: "755",
      owner: "root:root",
    },
    {
      remotePath: "/home/opencode/.config/opencode/mcp.json",
      content: MCP_JSON_CONTENT,
      permissions: "644",
      owner: "opencode:opencode",
    },
    {
      remotePath: "/home/opencode/.config/opencode/agents/tg-agent.md",
      content: payload.tgAgentMd,
      permissions: "644",
      owner: "opencode:opencode",
    },
  ];

  const fileResult = await deployFilesViaSsh(host, password, files, options);
  if (!fileResult.success) {
    return { success: false, error: `File deploy failed: ${fileResult.error}`, method: "ssh" };
  }

  // Phase 2: run shell commands (npm install, permissions, restart)
  const cmdResult = await injectViaSsh(host, password, FULL_UPDATE_SSH_COMMANDS, {
    ...options,
    timeout: 120000, // npm install can be slow
    useSudo: true,
  });
  if (!cmdResult.success) {
    return { success: false, error: `Commands failed: ${cmdResult.error}`, method: "ssh" };
  }

  return { success: true, method: "ssh" };
}
