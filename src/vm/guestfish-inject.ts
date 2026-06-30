import { exec } from "child_process";

/**
 * Default golden image fixes to apply to existing VMs.
 * Applied during VM update to match current golden image configuration.
 */
export const DEFAULT_GUESTFISH_FIXES: readonly string[] = [
  `sed -i 's/^[[:space:]]*PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config`,
  `mkdir -p /workspace/skills && rm -rf /home/opencode/.config/opencode/skills/user && ln -sfT /workspace/skills /home/opencode/.config/opencode/skills/user`,
] as const;

export interface GuestfishResult {
  success: boolean;
  error?: string;
  output?: string;
}

export interface GuestfishOptions {
  /** Timeout in milliseconds. Default: 120000 (120s). */
  timeout?: number;
}

/**
 * Inject shell commands into an OFFLINE qcow2 disk image via virt-customize.
 *
 * **IMPORTANT:** The VM MUST be shut off before calling this function.
 * virt-customize locks the disk and will fail if the VM is running.
 *
 * virt-customize modifies the TOP qcow2 layer, never the backing image.
 *
 * @param qcow2Path - Path to the qcow2 disk image
 * @param commands - Shell commands to run inside the VM's filesystem
 * @param options - Optional configuration (timeout)
 * @returns Result indicating success/failure with optional error and output
 */
export async function injectViaGuestfish(
  qcow2Path: string,
  commands: string[],
  options?: GuestfishOptions,
): Promise<GuestfishResult> {
  const timeout = options?.timeout ?? 120_000;

  // Build the virt-customize command
  // Each shell command is passed via --run-command
  // Double-quote the command strings to handle single quotes safely
  const runArgs = commands
    .map((cmd) => {
      // Escape any double-quotes inside the command and wrap in double quotes
      const escaped = cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `--run-command "${escaped}"`;
    })
    .join(" ");

  const fullCommand = `sudo virt-customize -a ${qcow2Path}${runArgs ? " " + runArgs : ""}`;

  return new Promise<GuestfishResult>((resolve) => {
    exec(fullCommand, { timeout }, (error, stdout, stderr) => {
      if (error) {
        const message = error.killed
          ? `virt-customize timed out after ${timeout}ms`
          : `virt-customize failed: ${error.message}`;
        resolve({
          success: false,
          error: message,
          output: stderr || stdout || undefined,
        });
        return;
      }

      // Restore ownership so libvirt can read the file
      exec(`sudo chown libvirt-qemu:libvirt-qemu ${qcow2Path}`, { timeout: 5000 }, (chownErr) => {
        if (chownErr) {
          resolve({
            success: false,
            error: `chown failed: ${chownErr.message}`,
            output: stdout || undefined,
          });
          return;
        }
        resolve({
          success: true,
          output: stdout || undefined,
        });
      });
    });
  });
}
