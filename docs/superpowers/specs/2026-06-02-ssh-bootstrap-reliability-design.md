# SSH fixes: Firewall, password, and state persistence across restart

## 1. Background

During SSH bootstrap to a remote server (host target), several reliability gaps were identified:

- Host target didn't open the firewall port, making the opencode server inaccessible from outside
- `opencode serve` on the remote server had no authentication 
- After bot restart, `recoverAll()` always reconnected to the first saved SSH connection even if
  the user had explicitly disconnected or was connected to a different server

## 2. Changes

### 2.1 Firewall port auto-open

**Problem:** Docker target already ran `iptables -A INPUT -p tcp --dport $PORT -j ACCEPT` after
`rebuildTunnel()`, but the host target was missing this step. Without it, the remote server's
firewall might block the opencode port.

**Fix:** Added the same `iptables` command to the host deployment path, placed right after
`rebuildTunnel()` — consistent with the Docker path.

### 2.2 Auto-generated opencode server password

**Problem:** `opencode serve` started without a password, making the opencode API accessible
on the remote server without authentication.

**Fix:**
- Added `opencodePassword?: string` to `SavedSshConnection` interface
- On `saveConnection()`, auto-generates `crypto.randomBytes(16).toString("hex")` password
- On `saveConnection()` update (existing connection), preserves existing password or generates
  one if missing (migration path for old connections)
- Stored encrypted inside the same `ssh_connections.json` file
- Docker path: passes `-e OPENCODE_SERVER_PASSWORD=<pw>` in `docker run`
- Host path: passes `exec env OPENCODE_SERVER_PASSWORD=<pw> opencode serve ...`
- `/server` command: when SSH is active, shows the SSH connection's own password instead of
  `config.opencode.password`

### 2.3 SSH connection state persistence

**Problem:** `recoverAll()` called `loadCredentials()` which returned the **first** saved
connection, ignoring which connection (if any) the user was actually connected to. After
restart, it always reconnected even if the user had disconnected.

**Fix:**
- Introduced `SshConnectionsStore` wrapper:
  ```
  { activeConnectionId: string | null, connections: SavedSshConnection[] }
  ```
- `loadConnectionsList()` / `persistConnectionsList()` handle both old format (plain array)
  and new format (wrapped object)
- `setActiveConnectionId(userId, id | null)` persists active state
- `recoverAll()`:
  - Reads `activeConnectionId` — if `null`, skips recovery (logs "skipping recovery")
  - If set, reconnects to THAT specific connection by id
  - On failure, keeps `activeConnectionId` so it retries on next restart
- `ACTION_DISCONNECT` handler clears `activeConnectionId`
- `doConnect()` and `ACTION_CONNECT` handler set `activeConnectionId` on success

## 3. Files changed

| File | What |
|------|------|
| `src/utils/ssh-manager.ts` | Added `opencodePassword` to interfaces, `SshConnectionsStore`, store read/write, `setActiveConnectionId`, `loadSavedByDetails`, updated `recoverAll`, added iptables to host path, added password to docker/host commands |
| `src/bot/commands/ssh.ts` | `doConnect` uses `saveConnection` + sets active, `ACTION_CONNECT` sets active, `ACTION_DISCONNECT` clears active |
| `src/bot/commands/server.ts` | Shows SSH connection's password when SSH is active |
