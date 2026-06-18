## Visual Browser Skills — Agent Setup

When a task requires browser automation, screenshots, or X11 window management, use these 3 skills:

| Skill | File | Purpose |
|-------|------|---------|
| `screen-manager` | `screen-manager.md` | Xvfb virtual display, xdotool/wmctrl window control |
| `visual-browser` | `visual-browser.md` | Chromium via CDP + Playwright: navigate, click, type |
| `screenshot` | `screenshot.md` | Screenshot via CDP, Playwright, scrot, ImageMagick |

### Prerequisites (auto-installed by install.sh)

- Xvfb, xdotool, wmctrl, scrot, ImageMagick, Chromium
- Playwright (Node.js) + playwright (Python)
- websockets (Python)

### First-time setup

Run `bash skills/visual-browser/install.sh` — it installs all system deps, npm/Python packages, and copies the 3 .md files into `~/.hermes/skills/`.

### Usage pattern

1. Start Xvfb: `Xvfb :99 -screen 0 1920x1080x24 -ac &`
2. Export display: `export DISPLAY=:99`
3. Launch Chromium with CDP: `chromium --no-sandbox --disable-gpu --remote-debugging-port=9222 &`
4. Load the skill instructions and use the tools

### Delivery rule

After installing, always deliver the completion message to the user via tg-upload.
