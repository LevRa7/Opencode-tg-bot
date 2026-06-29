#!/bin/bash
# inject-godmode-existing-vms.sh — Inject godmode bootstrap into EXISTING VM disks
# Uses virt-customize to write files to offline VM disk images.
# VMs will auto-deploy godmode on next boot.
# Requires: guestfs-tools (virt-customize), sudo
set -euo pipefail

IMAGES_DIR="${VM_IMAGES_DIR:-/home/me/vm-images}"
GODMODE_SCRIPT="/home/me/opencode-tg/.worktrees/terminal-agent/deploy/godmode-bootstrap.sh"
GODMODE_SERVICE="/home/me/opencode-tg/.worktrees/terminal-agent/deploy/godmode-bootstrap.service"

if ! command -v virt-customize &>/dev/null; then
  echo "ERROR: virt-customize not found. Install guestfs-tools: apt-get install guestfs-tools"
  exit 1
fi

if [ ! -f "$GODMODE_SCRIPT" ] || [ ! -f "$GODMODE_SERVICE" ]; then
  echo "ERROR: Godmode bootstrap files not found at:"
  echo "  Script: $GODMODE_SCRIPT"
  echo "  Service: $GODMODE_SERVICE"
  exit 1
fi

echo "=== Injecting godmode bootstrap into existing VM disks ==="
echo "Images dir: $IMAGES_DIR"
echo ""

# Find all VM disk images (opencode-tg-*.qcow2)
shopt -s nullglob
DISKS=("$IMAGES_DIR"/opencode-tg-*.qcow2)
shopt -u nullglob

if [ ${#DISKS[@]} -eq 0 ]; then
  echo "No VM disk images found in $IMAGES_DIR"
  exit 0
fi

echo "Found ${#DISKS[@]} VM disk(s):"
for disk in "${DISKS[@]}"; do
  echo "  - $(basename "$disk")"
done
echo ""

# Process each disk
INJECTED=0
SKIPPED=0
FAILED=0

for disk in "${DISKS[@]}"; do
  VM_NAME="$(basename "$disk" .qcow2)"
  echo "--- Processing: $VM_NAME ---"

  # Check if already bootstrapped (look for the flag file in the disk)
  if virt-customize -a "$disk" --run-command 'test -f /home/opencode/.config/opencode/.godmode-bootstrapped && echo "BOOTSTRAPPED" || echo "NOT_BOOTSTRAPPED"' 2>/dev/null | grep -q "BOOTSTRAPPED"; then
    # Double-check: is godmode provider actually in the config?
    if virt-customize -a "$disk" --run-command 'grep -q "godmode" /home/opencode/.config/opencode/opencode.json 2>/dev/null && echo "HAS_GODMODE" || echo "NO_GODMODE"' 2>/dev/null | grep -q "HAS_GODMODE"; then
      echo "  SKIP: Already bootstrapped with godmode provider"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi
    echo "  Bootstrap flag exists but config is broken — re-injecting..."
  fi

  # Stop VM if running (virt-customize needs exclusive disk access)
  VM_RUNNING=false
  if virsh list --name 2>/dev/null | grep -q "^${VM_NAME}$"; then
    echo "  Stopping VM..."
    virsh shutdown "$VM_NAME" 2>/dev/null || virsh destroy "$VM_NAME" 2>/dev/null || true
    sleep 3
    VM_RUNNING=true
  fi

  # Inject files using virt-customize
  echo "  Injecting godmode bootstrap files..."
  if virt-customize -a "$disk" \
    --mkdir /opt/godmode \
    --mkdir /home/opencode/.config/opencode/agents \
    --copy-in "$GODMODE_SCRIPT:/opt/godmode/" \
    --copy-in "$GODMODE_SERVICE:/etc/systemd/system/" \
    --run-command 'chmod +x /opt/godmode/godmode-bootstrap.sh' \
    --run-command 'chown -R opencode:opencode /opt/godmode /home/opencode/.config/opencode 2>/dev/null || true' \
    --run-command 'systemctl enable godmode-bootstrap 2>/dev/null || true' \
    2>&1; then
    echo "  OK: Injected successfully"
    INJECTED=$((INJECTED + 1))
  else
    echo "  FAIL: virt-customize failed"
    FAILED=$((FAILED + 1))
  fi

  # Start VM if it was running
  if [ "$VM_RUNNING" = true ]; then
    echo "  Starting VM..."
    virsh start "$VM_NAME" 2>/dev/null || true
  fi

  echo ""
done

echo "=== Summary ==="
echo "  Injected: $INJECTED"
echo "  Skipped:  $SKIPPED"
echo "  Failed:   $FAILED"
echo ""
echo "On next boot, each VM will auto-deploy godmode (prefill proxy, Zen models, TG-Agent)."
echo "To deploy immediately (without waiting for reboot), the VM agent can run:"
echo "  sudo systemctl start godmode-bootstrap"
