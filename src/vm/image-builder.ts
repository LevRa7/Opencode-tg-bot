#!/usr/bin/env node
/**
 * Golden Image Builder
 * Builds opencode-base.qcow2 — Debian 12 + full OpenCode stack + skills + dependencies.
 *
 * Run on a server with KVM/libvirt installed:
 *   npx tsx src/vm/image-builder.ts [--force] [--image-dir /var/lib/libvirt/images]
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

const IMAGES_DIR = process.env.VM_IMAGES_DIR || "/var/lib/libvirt/images";
const BASE_IMAGE_NAME = "opencode-base.qcow2";
const DEBIAN_URL =
  "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2";
const DEBIAN_CACHE = path.join(IMAGES_DIR, "debian-12-genericcloud-amd64.qcow2");

// ── helpers ────────────────────────────────────────────────────────────────

function sh(cmd: string, opts?: { ignoreError?: boolean }): string {
  console.log(`  $ ${cmd}`);
  try {
    const out = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] });
    return out;
  } catch (err) {
    if (opts?.ignoreError) return "";
    throw err;
  }
}

function check(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── installer scripts (heredoc) ────────────────────────────────────────────

const INSTALL_OPENCODE = `#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg

# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y -qq nodejs

# Python 3 + pip
apt-get install -y -qq python3 python3-pip python3-venv

# npm install opencode globally
npm install -g @opencode-ai/cli

echo "OpenCode CLI installed: $(opencode --version 2>&1 || echo 'version check skipped')"
`;

const INSTALL_SYSTEM_DEPS = `#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Browser + media + build tools
apt-get install -y -qq \\
  chromium ffmpeg imagemagick \\
  git curl ca-certificates \\
  xvfb scrot xdotool wmctrl \\
  make gcc g++ cmake \\
  libsqlite3-dev whois \\
  cloud-init

# Playwright deps
npx playwright install-deps chromium 2>/dev/null || true
npx playwright install chromium 2>/dev/null || true

echo "System dependencies installed"
`;

const INSTALL_PYTHON_PKGS = `#!/bin/bash
set -e
pip3 install --break-system-packages \\
  openai-whisper chromadb pyfiglet pygount pymupdf debugpy \\
  python-pptx biopython pillow \\
  huggingface-hub

echo "Python packages installed"
`;

const INSTALL_NODE_PKGS = `#!/bin/bash
set -e
npm install -g \\
  better-sqlite3 dotenv express qrcode tsx

echo "Node.js global packages installed"
`;

const INSTALL_TG_CLI = `#!/bin/bash
set -e
pip3 install --break-system-packages tg-cli 2>/dev/null || {
  echo "tg-cli via pip failed, installing from source..."
  git clone https://github.com/LevRa7/python-tg-cli.git /tmp/tg-cli-build 2>/dev/null || true
  cd /tmp/tg-cli-build && pip3 install --break-system-packages -e . 2>/dev/null || true
}
echo "tg-cli installed"
`;

const OPENCODE_SERVICE = `[Unit]
Description=OpenCode Server
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/opencode serve --hostname 0.0.0.0 --port 4096
EnvironmentFile=/etc/opencode/env
Restart=always
RestartSec=5
User=opencode
Group=opencode
WorkingDirectory=/workspace

[Install]
WantedBy=multi-user.target
`;

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const force = process.argv.includes("--force");
  const imageDir = process.argv
    .find((a, i) => a === "--image-dir" && i + 1 < process.argv.length)
    ?.replace(/^--image-dir[= ]/, "") || IMAGES_DIR;

  console.log("=== OpenCode Golden Image Builder ===\n");
  console.log(`Image dir: ${imageDir}`);
  console.log(`Base image: ${BASE_IMAGE_NAME}\n`);

  // Prerequisites
  for (const tool of ["qemu-img", "virt-customize", "virt-sparsify"]) {
    if (!check(tool)) {
      console.error(`ERROR: ${tool} not found. Install libguestfs-tools.`);
      process.exit(1);
    }
  }
  mkdirSync(imageDir, { recursive: true });

  // ── 1. Download Debian cloud image ──
  console.log("--- Step 1: Base Debian image ---");
  if (existsSync(DEBIAN_CACHE) && !force) {
    console.log(`  Using cached: ${DEBIAN_CACHE}`);
  } else {
    console.log(`  Downloading: ${DEBIAN_URL}`);
    sh(`curl -fSL -o "${DEBIAN_CACHE}" "${DEBIAN_URL}"`);
  }

  // ── 2. Copy to working image ──
  const workImage = path.join(imageDir, "opencode-build-tmp.qcow2");
  console.log("\n--- Step 2: Prepare working image ---");
  if (existsSync(workImage)) sh(`rm -f "${workImage}"`);
  sh(`cp "${DEBIAN_CACHE}" "${workImage}"`);

  // ── 3. Write install scripts ──
  console.log("\n--- Step 3: Write install scripts ---");
  const scriptsDir = path.join(imageDir, "build-scripts");
  mkdirSync(scriptsDir, { recursive: true });

  const scripts: Record<string, string> = {
    "install-opencode.sh": INSTALL_OPENCODE,
    "install-system-deps.sh": INSTALL_SYSTEM_DEPS,
    "install-python-pkgs.sh": INSTALL_PYTHON_PKGS,
    "install-node-pkgs.sh": INSTALL_NODE_PKGS,
    "install-tg-cli.sh": INSTALL_TG_CLI,
  };

  for (const [name, content] of Object.entries(scripts)) {
    writeFileSync(path.join(scriptsDir, name), content, { mode: 0o755 });
  }

  // ── 4. Resize disk (separate step, virt-customize does not support --resize) ──
  console.log("\n--- Step 4: Resize disk ---");
  sh(`qemu-img resize "${workImage}" +10G`);

  // ── 5. virt-customize ──
  console.log("\n--- Step 5: virt-customize (this takes ~10-20 min) ---");
  const scriptArgs = Object.keys(scripts)
    .map((s) => `--run "${path.join(scriptsDir, s)}"`)
    .join(" ");

  sh(
    [
      "virt-customize",
      `-a "${workImage}"`,
      // System deps first
      `--run "${path.join(scriptsDir, 'install-system-deps.sh')}"`,
      // Node.js + opencode
      `--run "${path.join(scriptsDir, 'install-opencode.sh')}"`,
      // Python packages
      `--run "${path.join(scriptsDir, 'install-python-pkgs.sh')}"`,
      // Node.js global packages
      `--run "${path.join(scriptsDir, 'install-node-pkgs.sh')}"`,
      // tg-cli
      `--run "${path.join(scriptsDir, 'install-tg-cli.sh')}"`,
      // Enable cloud-init for per-tenant customization
      `--run-command "systemctl enable cloud-init"`,
      `--run-command "systemctl enable cloud-config"`,
      `--run-command "systemctl enable cloud-final"`,
      // Create opencode user
      `--run-command "useradd -m -s /bin/bash opencode || true"`,
      `--run-command "echo 'opencode ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/opencode"`,
      // Create workspace directory
      `--run-command "mkdir -p /workspace /state/skills && chown opencode:opencode /workspace /state"`,
      // Install opencode systemd service
      `--run-command "cat > /etc/systemd/system/opencode.service <<'SERVICEEOF'\n${OPENCODE_SERVICE}\nSERVICEEOF"`,
      `--run-command "systemctl enable opencode"`,
      // Verify kernel has virtio-mem support
      `--run-command "uname -r"`,
      // Clean apt cache
      `--run-command "apt-get clean"`,
      // SELinux relabel
      `--selinux-relabel`,
    ].join(" "),
  );

  // ── 5. Sparsify ──
  console.log("\n--- Step 5: Sparsify ---");
  const finalImage = path.join(imageDir, BASE_IMAGE_NAME);
  if (existsSync(finalImage)) sh(`rm -f "${finalImage}"`);
  sh(`virt-sparsify --compress "${workImage}" "${finalImage}"`);

  // ── 6. Cleanup ──
  console.log("\n--- Step 6: Cleanup ---");
  sh(`rm -f "${workImage}"`, { ignoreError: true });
  sh(`rm -rf "${scriptsDir}"`, { ignoreError: true });

  // ── Done ──
  console.log(`\n=== Golden image ready: ${finalImage} ===`);
  const size = execSync(`qemu-img info "${finalImage}" --output=json`, { encoding: "utf-8" });
  const info = JSON.parse(size);
  console.log(`Virtual size: ${info["virtual-size"]} bytes`);
  console.log(`Actual size:  ${info["actual-size"]} bytes`);
  console.log(`Format:       ${info.format}`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
