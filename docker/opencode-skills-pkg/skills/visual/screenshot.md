---
name: screenshot
description: Screenshot capture via CDP, Playwright, scrot, ImageMagick, and X11
license: MIT
compatibility: hermes-agent
---

# Screenshot — Screen Capture Tools

Capture screenshots from Xvfb virtual displays, Chromium/CDP, and command-line tools.

## Prerequisites

```bash
apt install -y scrot imagemagick xvfb xdotool
```

## Screenshots via X11 (full display)

```bash
export DISPLAY=:99

# ImageMagick import (fastest, most reliable)
import -window root screenshot.png

# scrot (supports regions)
scrot -d 1 screenshot.png       # 1s delay
scrot -s screenshot.png          # interactive selection
```

## Screenshot via Chromium CDP

```bash
curl -s http://localhost:9222/json > /tmp/tabs.json
TAB_URL=$(python3 -c "import json; tabs=json.load(open('/tmp/tabs.json')); print(tabs[0]['webSocketDebuggerUrl'])")

python3 << 'PY'
import json, base64, websockets, asyncio, sys

async def capture(ws_url):
    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Page.captureScreenshot", "params": {"format": "png", "fromSurface": True}}))
        resp = json.loads(await ws.recv())
        with open("screenshot.png", "wb") as f:
            f.write(base64.b64decode(resp["result"]["data"]))

asyncio.run(capture(sys.argv[1]))
PY
```

## Screenshot via Playwright (Python)

```python
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-gpu']
        )
        page = await browser.new_page(viewport={'width': 1280, 'height': 720})
        await page.goto('https://example.com')
        await page.screenshot(path='screenshot.png', full_page=True)
        await page.screenshot(path='screenshot-visual.png')
        await browser.close()

asyncio.run(main())
```

## Screenshot via Playwright (Node.js)

```bash
npx playwright --version 2>/dev/null || npx playwright install chromium

node << 'JS'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(process.argv[1] || 'https://example.com');
  await page.screenshot({ path: 'screenshot.png', fullPage: true });
  await browser.close();
})();
JS
```

## Region/area screenshot

```bash
export DISPLAY=:99

# ImageMagick with geometry
import -window root -crop 800x600+100+50 region.png

# xdotool get window position + import
WID=$(xdotool search --name "Chromium" | head -1)
eval $(xdotool getwindowgeometry --shell $WID)
import -window root -crop ${WIDTH}x${HEIGHT}+${X}+${Y} window-screenshot.png
```

## Options comparison

| Tool | Full page | Region | Remote | Speed |
|------|-----------|--------|--------|-------|
| `import` (ImageMagick) | Yes | Yes | No | Fast |
| `scrot` | Yes | Yes | No | Fast |
| CDP `Page.captureScreenshot` | No | Yes | Yes | Medium |
| CDP `Page.printToPDF` | Yes | — | Yes | Medium |
| Playwright `screenshot` | Yes | Yes | Yes | Slow |
| Playwright `fullPage: true` | Yes | — | Yes | Slow |

## Notes

- Set `export DISPLAY=:99` before running any X11 screenshot tool
- For CDP screenshots: Chromium must be started with `--remote-debugging-port=9222`
- Use `import -window root` for reliability — works with any X11 app
- For headless pipeline: Xvfb → launch app → import → analyze → act
- Base64-encoded screenshots from CDP can be decoded: `base64 -d` or Python `base64.b64decode`
