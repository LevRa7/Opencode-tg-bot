---
name: visual-browser
description: Chromium visual browser control via CDP and Playwright
license: MIT
compatibility: hermes-agent
---

# Visual Browser — Chromium CDP & Playwright

Control a real Chromium browser visually — navigate, click, type, extract content,
and take page screenshots. Uses Chrome DevTools Protocol (CDP) directly or via Playwright.

## Prerequisites

```bash
# Chromium browser (system)
apt install -y chromium

# Playwright (full automation)
npx playwright install chromium
```

## Launch Chromium with CDP

```bash
export DISPLAY=:99
chromium \
  --no-sandbox \
  --disable-gpu \
  --remote-debugging-port=9222 \
  --remote-allow-origins=* \
  --window-size=1280,720 \
  --window-position=0,0 \
  --disable-dev-shm-usage \
  --user-data-dir=/tmp/chromium-profile &
```

## CDP control via bash + curl

```bash
# Get WebSocket URL
WS_URL=$(curl -s http://localhost:9222/json/version | python3 -c "import sys,json; print(json.load(sys.stdin)['webSocketDebuggerUrl'])")

# Navigate to URL
TARGET_URL="https://example.com"
curl -s -X POST http://localhost:9222/json/new?file:///dev/stdin 2>/dev/null
```

## CDP control via Python script

```python
import json, websockets, asyncio

async def cdp_command(ws_url, method, params=None):
    async with websockets.connect(ws_url) as ws:
        msg_id = 1
        cmd = json.dumps({"id": msg_id, "method": method, "params": params or {}})
        await ws.send(cmd)
        resp = await ws.recv()
        return json.loads(resp)

async def main():
    ws_url = "ws://localhost:9222/devtools/browser/..."
    # Navigate
    await cdp_command(ws_url, "Page.navigate", {"url": "https://example.com"})
    await asyncio.sleep(2)
    # Get page title
    result = await cdp_command(ws_url, "Runtime.evaluate", {"expression": "document.title"})
    print(result["result"]["result"]["value"])
    # Screenshot
    result = await cdp_command(ws_url, "Page.captureScreenshot", {"format": "png"})
    with open("screenshot.png", "wb") as f:
        import base64
        f.write(base64.b64decode(result["result"]["data"]))

asyncio.run(main())
```

## Playwright control via Node.js

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,        // false = visible Xvfb window
    args: ['--no-sandbox', '--disable-gpu'],
    env: { DISPLAY: ':99' },
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('https://example.com');
  await page.screenshot({ path: 'screenshot.png', fullPage: true });
  const title = await page.title();
  await browser.close();
})();
```

## Get list of open pages/tabs

```bash
curl -s http://localhost:9222/json | python3 -m json.tool
```

## Close a tab

```bash
curl -s -X PUT http://localhost:9222/json/close/<TAB_ID>
```

## Open URL in new tab

```bash
curl -s http://localhost:9222/json/new?https://example.com
```

## Key CDP methods

| Method | Purpose |
|--------|---------|
| `Page.navigate` | Navigate to URL |
| `Page.captureScreenshot` | Take screenshot |
| `Page.printToPDF` | Generate PDF |
| `Runtime.evaluate` | Execute JavaScript |
| `Input.dispatchMouseEvent` | Click/scroll |
| `Input.dispatchKeyEvent` | Type text |
| `DOM.getDocument` | Get page DOM |
| `DOM.querySelector` | Find element |
| `DOM.getOuterHTML` | Get element HTML |

## Notes

- Always set `DISPLAY=:99` (or your Xvfb display) in env
- Use `--remote-debugging-port=9222` for CDP access
- With headless Xvfb, Chromium still renders visually in the framebuffer
- Take screenshots via CDP to verify visual state
- Use `--window-size` to set initial viewport size
