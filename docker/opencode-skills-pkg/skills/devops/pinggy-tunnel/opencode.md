# Pinggy Tunnel

Expose a local service to the public internet using Pinggy SSH reverse tunnel. No daemon to install — stock SSH client connects to `a.pinggy.io:443`.

Free tier: 60-minute tunnels, random subdomain, no signup.

## When to Use

- User asks to "expose this locally", "share my dev server", "tunnel port N"
- Need to receive a webhook callback (Stripe, GitHub, Discord)
- Sharing a one-off HTTP demo (MCP server, Ollama endpoint, dashboard)
- Host has SSH but no cloudflared/ngrok

## Quick Reference

```bash
# Basic HTTP/HTTPS tunnel
ssh -p 443 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 \
    -R0:localhost:8000 free@a.pinggy.io

# TCP tunnel (databases, SSH)
ssh -p 443 -o StrictHostKeyChecking=no -R0:localhost:5432 tcp@a.pinggy.io

# With basic auth
ssh -p 443 -o StrictHostKeyChecking=no \
    -R0:localhost:8000 "b:admin:secret+free@a.pinggy.io"

# With bearer token
ssh -p 443 -o StrictHostKeyChecking=no \
    -R0:localhost:8000 "k:mysecrettoken+free@a.pinggy.io"

# Pro tier (persistent URL, no 60-min cap)
ssh -p 443 -o StrictHostKeyChecking=no \
    -R0:localhost:8000 "$PINGGY_TOKEN+a.pinggy.io"
```

## Procedure

### 1. Confirm local origin is up

```bash
curl -sI http://127.0.0.1:8000/ | head -1
```

### 2. Launch tunnel in background

```bash
LOG=/tmp/pinggy-8000.log
nohup ssh -p 443 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 -R0:localhost:8000 free@a.pinggy.io \
    > "$LOG" 2>&1 &
echo $! > /tmp/pinggy-8000.pid
```

### 3. Parse URL from log

```bash
sleep 4
grep -oE 'https://[a-z0-9-]+\.[a-z]+\.pinggy\.link' /tmp/pinggy-8000.log | head -1
```

### 4. Teardown

```bash
kill "$(cat /tmp/pinggy-8000.pid)"
```

## Access Control Keywords

Stack in SSH username separated by `+`: `b:user:pass` (Basic auth), `k:token` (bearer), `w:CIDR` (IP whitelist), `co` (CORS), `x:https` (force HTTPS), `qr` (QR code).

## Pitfalls

- 60-minute hard cap on free tier (URL changes on restart)
- Concurrent free tunnels limited to one per source IP
- Always quote the username when it contains `+`
- Always use access control for non-public services
- Pass `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` for unattended runs
