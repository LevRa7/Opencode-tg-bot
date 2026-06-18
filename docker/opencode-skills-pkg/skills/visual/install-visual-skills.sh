#!/usr/bin/env bash
set -euo pipefail

# === Automatic install script: Visual Browser Skills for Hermes Agent ===
# Downloads + installs 3 skills: screen-manager, visual-browser, screenshot
# Plus all required system dependencies.

SKILLS_DIR="${HERMES_HOME:-$HOME/.hermes}/skills"
SKILLS_URL="https://raw.githubusercontent.com/lvt382009/hermes-visual-skills/main/skills"

echo "[1/3] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
    xvfb xdotool wmctrl scrot imagemagick \
    chromium python3-pip nodejs npm 2>/dev/null

echo "[2/3] Installing Playwright + Python WebSocket client..."
npm install -g playwright 2>/dev/null
npx playwright install chromium 2>/dev/null || true
pip3 install playwright websockets 2>/dev/null

echo "[3/3] Installing skills..."
mkdir -p "$SKILLS_DIR"
for skill in screen-manager.md visual-browser.md screenshot.md; do
    curl -fsSL "$SKILLS_URL/$skill" -o "$SKILLS_DIR/$skill"
    echo "  ✓ $skill"
done

echo ""
echo "=== Complete ==="
echo "Skills installed: $SKILLS_DIR"
echo ""
echo "Quick start:"
echo "  1. Xvfb :99 -screen 0 1920x1080x24 -ac &"
echo "  2. export DISPLAY=:99"
echo "  3. Start a session and use the visual-browser / screenshot skills"
