---
name: screen-manager
description: Xvfb virtual screen, X11 display management, xdotool window control
license: MIT
compatibility: hermes-agent
---

# Screen Manager — Xvfb, X11, Displays & Windows

Manage virtual screens via Xvfb (X Virtual Framebuffer) for headless environments.
Control windows, simulate mouse/keyboard input via xdotool.

## Prerequisites

```bash
apt install -y xvfb xdotool wmctrl
```

## Start a virtual display

```bash
# Start Xvfb on display :99 with 1920x1080x24
Xvfb :99 -screen 0 1920x1080x24 -ac &
export DISPLAY=:99

# Verify it's running
xdpyinfo -display :99 2>/dev/null | head -5
```

## Start Xvfb with explicit resolution

```bash
Xvfb :99 -screen 0 1280x720x24 -ac +extension RANDR &
```

## Window management (xdotool)

```bash
# List windows
xdotool search . --name "" 2>/dev/null

# Get active window ID
xdotool getactivewindow

# Move and resize
xdotool windowmove <WINDOW_ID> 0 0
xdotool windowsize <WINDOW_ID> 1024 768

# Focus a window by name
xdotool search --name "google" windowactivate

# Type text
xdotool type "Hello world"

# Simulate key presses
xdotool key Return
xdotool key ctrl+l
```

## Window management (wmctrl)

```bash
# List all windows
wmctrl -l

# Activate window by title
wmctrl -a "Chromium"

# Resize to specific geometry
wmctrl -r "Chromium" -e 0,0,0,1280,720
```

## Kill Xvfb

```bash
pkill Xvfb
```

## Notes

- Set `DISPLAY` before launching any GUI app: `export DISPLAY=:99`
- Xvfb must be running on the target display before any app tries to use it
- For rendering-heavy pages, prefer Xdummy (dummy driver) over Xvfb
- Chromium needs `--no-sandbox --disable-gpu` in Xvfb
