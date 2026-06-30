import { describe, it, expect, vi } from "vitest";
import { generateContextIso, generateInfrastructureIso } from "../../src/vm/cloud-init.js";
import type { CloudInitContext } from "../../src/vm/cloud-init.js";

describe("generateContextIso SSH & skills", () => {
  it("includes SSH PasswordAuthentication fix in runcmd with [[:space:]]* regex", () => {
    const mockExec = vi.fn().mockReturnValue("$6$hash123");
    const mockWrite = vi.fn();
    const mockMkdir = vi.fn();

    const ctx: CloudInitContext = {
      userId: 123,
      opencodePassword: "test-opencode-pw",
      sudoPassword: "test-sudo-pw",
    };

    generateContextIso(ctx, "/tmp/test-context.iso", mockExec, mockWrite, mockMkdir);

    // Find the user-data write call
    const userDataCall = mockWrite.mock.calls.find(
      (call: any[]) => String(call[0] ?? "").endsWith("user-data"),
    );
    expect(userDataCall).toBeDefined();
    const userData = userDataCall![1] as string;

    // C1 FIX: SSH PasswordAuthentication fix — sed command with [[:space:]]* to match indented lines
    expect(userData).toContain(
      "sed -i 's/^[[:space:]]*PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null || true",
    );

    // SSH restart after sed
    expect(userData).toContain(
      "systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true",
    );
  });

  it("includes skills workspace symlink with rm -rf and -T flag", () => {
    const mockExec = vi.fn().mockReturnValue("$6$hash123");
    const mockWrite = vi.fn();
    const mockMkdir = vi.fn();

    const ctx: CloudInitContext = {
      userId: 456,
      opencodePassword: "another-opencode-pw",
      sudoPassword: "another-sudo-pw",
    };

    generateContextIso(ctx, "/tmp/test-context2.iso", mockExec, mockWrite, mockMkdir);

    const userDataCall = mockWrite.mock.calls.find(
      (call: any[]) => String(call[0] ?? "").endsWith("user-data"),
    );
    expect(userDataCall).toBeDefined();
    const userData = userDataCall![1] as string;

    // C2 FIX: Skills workspace symlink — uses rm -rf + ln -sfT to avoid nested symlink
    expect(userData).toContain(
      "mkdir -p /workspace/skills && rm -rf /home/opencode/.config/opencode/skills/user 2>/dev/null; ln -sfT /workspace/skills /home/opencode/.config/opencode/skills/user 2>/dev/null || true",
    );
  });

  it("still includes existing runcmd commands (no regression)", () => {
    const mockExec = vi.fn().mockReturnValue("$6$hash123");
    const mockWrite = vi.fn();
    const mockMkdir = vi.fn();

    const ctx: CloudInitContext = {
      userId: 789,
      opencodePassword: "pw3",
      sudoPassword: "spw3",
    };

    generateContextIso(ctx, "/tmp/test-context3.iso", mockExec, mockWrite, mockMkdir);

    const userDataCall = mockWrite.mock.calls.find(
      (call: any[]) => String(call[0] ?? "").endsWith("user-data"),
    );
    expect(userDataCall).toBeDefined();
    const userData = userDataCall![1] as string;

    // Existing commands still present
    expect(userData).toContain("systemctl daemon-reload");
    expect(userData).toContain("systemctl restart opencode || systemctl start opencode");
    expect(userData).toContain("mkdir -p /workspace/skills");
    expect(userData).toContain("ssh_pwauth: true");
  });
});

describe("generateInfrastructureIso (seed ISO)", () => {
  it("includes SSH PasswordAuthentication fix with [[:space:]]* regex", () => {
    const mockExec = vi.fn();
    const mockWrite = vi.fn();
    const mockMkdir = vi.fn();

    generateInfrastructureIso("test-vm", "2001:db8::1", "/tmp/test-infra.iso", mockExec, mockWrite, mockMkdir);

    const userDataCall = mockWrite.mock.calls.find(
      (call: any[]) => String(call[0] ?? "").endsWith("user-data"),
    );
    expect(userDataCall).toBeDefined();
    const userData = userDataCall![1] as string;

    // C3: Seed ISO must have SSH fix with [[:space:]]* regex
    expect(userData).toContain(
      "sed -i 's/^[[:space:]]*PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null || true",
    );

    // C3: Seed ISO must have SSH restart
    expect(userData).toContain(
      "systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true",
    );
  });

  it("includes skills workspace symlink with rm -rf and -T flag", () => {
    const mockExec = vi.fn();
    const mockWrite = vi.fn();
    const mockMkdir = vi.fn();

    generateInfrastructureIso("test-vm2", "2001:db8::2", "/tmp/test-infra2.iso", mockExec, mockWrite, mockMkdir);

    const userDataCall = mockWrite.mock.calls.find(
      (call: any[]) => String(call[0] ?? "").endsWith("user-data"),
    );
    expect(userDataCall).toBeDefined();
    const userData = userDataCall![1] as string;

    // C3: Seed ISO must have skills symlink with rm -rf + ln -sfT
    expect(userData).toContain(
      "mkdir -p /workspace/skills && rm -rf /home/opencode/.config/opencode/skills/user 2>/dev/null; ln -sfT /workspace/skills /home/opencode/.config/opencode/skills/user 2>/dev/null || true",
    );
  });
});
