import { describe, it, expect, vi } from "vitest";
import {
  generateSudoPassword,
  hashPassword,
  generateCloudInitIso,
} from "../../src/vm/cloud-init.js";
import { VM_TIERS } from "../../src/vm/types.js";

describe("generateSudoPassword", () => {
  it("returns a 16-character string", () => {
    const pw = generateSudoPassword();
    expect(pw).toHaveLength(16);
    expect(typeof pw).toBe("string");
  });

  it("returns only base64url-safe characters", () => {
    const pw = generateSudoPassword();
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns different passwords on successive calls", () => {
    const pw1 = generateSudoPassword();
    const pw2 = generateSudoPassword();
    const pw3 = generateSudoPassword();
    expect(pw1).not.toBe(pw2);
    expect(pw1).not.toBe(pw3);
    expect(pw2).not.toBe(pw3);
  });
});

describe("hashPassword", () => {
  it("returns a SHA-512 hash string", () => {
    const mockExec = vi
      .fn()
      .mockReturnValue(
        "$6$rounds=4096$saltvalue$encryptedpasswordhashvalue1234",
      );
    const hash = hashPassword("test123", mockExec);
    expect(hash).toContain("$6$");
    expect(hash).toMatch(/^\$6\$[a-zA-Z0-9./=$]+\$[a-zA-Z0-9./]+$/);
  });

  it("uses the injected execSync when provided", () => {
    const mockExec = vi.fn().mockReturnValue("$6$mockedhash");
    const hash = hashPassword("test123", mockExec);
    expect(hash).toBe("$6$mockedhash");
    expect(mockExec).toHaveBeenCalledWith(
      'mkpasswd -m sha-512 -- "test123"',
      { encoding: "utf-8" },
    );
  });

  it("trims whitespace from execSync output", () => {
    const mockExec = vi.fn().mockReturnValue("$6$mockedhash\n\n");
    const hash = hashPassword("test123", mockExec);
    expect(hash).toBe("$6$mockedhash");
  });
});

describe("generateCloudInitIso", () => {
  it("writes user-data with hostname, password, write_files and calls cloud-localds", () => {
    const spec = VM_TIERS.small;
    const outputPath = "/tmp/test-cloud-init.iso";
    const userId = 123;

    const mockExec = vi.fn().mockReturnValue("$6$hash123");
    const mockWrite = vi.fn();
    const mockMkdir = vi.fn();

    generateCloudInitIso(
      userId,
      spec,
      "opencode-pw",
      "sudo-pw",
      outputPath,
      mockExec,
      mockWrite,
      mockMkdir,
    );

    // mkdir was called for the output directory
    expect(mockMkdir).toHaveBeenCalledWith("/tmp", { recursive: true });

    // At least user-data and meta-data files are written
    // (additional writes may happen for network-config depending on implementation)
    expect(mockWrite.mock.calls.length).toBeGreaterThanOrEqual(2);

    const userDataCall = mockWrite.mock.calls.find(
      ([filePath]: [string]) => filePath.endsWith("user-data"),
    );
    const metaDataCall = mockWrite.mock.calls.find(
      ([filePath]: [string]) => filePath.endsWith("meta-data"),
    );

    expect(userDataCall).toBeDefined();
    expect(metaDataCall).toBeDefined();

    const userData = userDataCall![1] as string;

    // Hostname includes domain prefix and user ID
    expect(userData).toContain("hostname: opencode-tg-123");

    // User section
    expect(userData).toContain("name: opencode");
    expect(userData).toContain("sudo: ALL=(ALL) NOPASSWD:ALL");
    expect(userData).toContain("passwd: $6$");

    // Password in write_files (env file)
    expect(userData).toContain("OPENCODE_SERVER_PASSWORD=opencode-pw");
    expect(userData).toContain("TG_ID=123");

    // sudo password in runcmd (creates .sudo file with chmod 0600)
    expect(userData).toContain('echo "sudo-pw" > /home/opencode/.sudo');
    expect(userData).toContain("chmod 600 /home/opencode/.sudo");

    // AGENTS.md references .sudo path, NOT the password itself
    expect(userData).toContain("path: /workspace/AGENTS.md");
    expect(userData).toContain("/home/opencode/.sudo");
    // AGENTS.md must NOT contain the actual password
    const agentsBlock = userData.substring(
      userData.indexOf("path: /workspace/AGENTS.md"),
      userData.indexOf("runcmd:"),
    );
    expect(agentsBlock).not.toContain("sudo-pw");

    // runcmd: daemon-reload + restart (or start) opencode service
    expect(userData).toContain("systemctl daemon-reload");
    expect(userData).toContain("systemctl restart opencode || systemctl start opencode");

    // systemd service file uses v1 opencode serve (not lildax)
    const serviceBlock = userData.substring(
      userData.indexOf("path: /etc/systemd/system/opencode.service"),
      userData.indexOf("runcmd:"),
    );
    expect(serviceBlock).toContain("ExecStart=/usr/local/bin/opencode serve");
    expect(serviceBlock).not.toContain("lildax");
    expect(serviceBlock).toContain("EnvironmentFile=/etc/opencode/env");
    expect(serviceBlock).toContain("Restart=always");

    // Meta-data contains instance-id and hostname
    const metaData = metaDataCall![1] as string;
    expect(metaData).toContain("instance-id: opencode-tg-123");
    expect(metaData).toContain("local-hostname: opencode-tg-123");

    // cloud-localds was called with correct paths
    expect(mockExec).toHaveBeenCalledTimes(2); // mkpasswd + cloud-localds
    const cloudLocaldsCall = mockExec.mock.calls.find(
      ([cmd]: [string]) => cmd.startsWith("cloud-localds"),
    );
    expect(cloudLocaldsCall).toBeDefined();
    expect(cloudLocaldsCall![0]).toContain(`"${outputPath}"`);
    expect(cloudLocaldsCall![0]).toContain("user-data");
    expect(cloudLocaldsCall![0]).toContain("meta-data");
  });

  it("calls mkpasswd with the sudo password via hashPassword", () => {
    const spec = VM_TIERS.medium;
    const mockExec = vi.fn().mockReturnValue("$6$hash123");

    generateCloudInitIso(
      456,
      spec,
      "opw",
      "sudopw",
      "/tmp/out.iso",
      mockExec,
      vi.fn(),
      vi.fn(),
    );

    // First exec call is mkpasswd for the sudo password
    expect(mockExec.mock.calls[0][0]).toBe('mkpasswd -m sha-512 -- "sudopw"');
  });

  it("writes user-data with correct hostname for different user IDs", () => {
    const mockExec = vi.fn().mockReturnValue("$6$hash999");
    const mockWrite = vi.fn();

    generateCloudInitIso(999, VM_TIERS.large, "pw", "spw", "/tmp/out.iso", mockExec, mockWrite, vi.fn());

    const userDataCall = mockWrite.mock.calls.find(
      ([p]: [string]) => p.endsWith("user-data"),
    );
    const userData = userDataCall![1] as string;
    expect(userData).toContain("hostname: opencode-tg-999");
    expect(userData).toContain("TG_ID=999");
  });
});
