# Antigravity CLI (`agy`)

Operator guide for the Antigravity CLI. Run `agy` commands through Bash. Inspect config and logs with Read.

## When to Use

- Installing, updating, or smoke-testing the `agy` binary
- Driving non-interactive `agy --print` one-shots
- Debugging Antigravity auth, sandbox, permissions, or plugin state
- Reading Antigravity settings, keybindings, conversations, or logs

## Mental Model

Two layers — keep them distinct:
1. **Shell wrapper commands** — `agy help`, `agy install`, `agy plugin`, `agy update`. Run via Bash.
2. **Interactive in-session slash commands** — `/config`, `/permissions`, `/skills`, `/agents`, etc. Only exist inside a running `agy` TUI session.

`agy help` shows the shell wrapper surface, NOT the in-session slash commands.

## Quick Reference

### Wrapper commands
`agy changelog`, `agy help`, `agy install`, `agy plugin`, `agy update`

### Useful flags
`--add-dir`, `--continue`/`-c`, `--conversation`, `--dangerously-skip-permissions`, `--print`/`-p`, `--print-timeout`, `--prompt`, `--prompt-interactive`/`-i`, `--sandbox`, `--log-file`, `--version`

### Plugin subcommands
`list`, `import`, `install`, `uninstall`, `enable`, `disable`, `validate`, `link`

### In-session slash commands
- **Conversation:** `/resume`, `/rewind`, `/rename`, `/clear`, `/fork`, `/reset`, `/new`
- **Settings:** `/config`, `/settings`, `/permissions`, `/model`, `/keybindings`, `/tasks`, `/skills`, `/mcp`, `/open`, `/usage`, `/logout`, `/agents`
- **Helpers:** `@` path autocomplete, `!` runs terminal command, `?` help

## Core Paths

- App data: `~/.gemini/antigravity-cli/`
- Settings: `~/.gemini/antigravity-cli/settings.json`
- Keybindings: `~/.gemini/antigravity-cli/keybindings.json`
- Logs: `~/.gemini/antigravity-cli/log/cli-*.log`
- Conversations: `~/.gemini/antigravity-cli/conversations/`

## Authentication

- CLI tries OS secure keyring first
- Falls back to browser-based Google sign-in
- Over SSH: prints authorization URL, expects pasted auth code
- `/logout` removes saved credentials

## Pitfalls

- `agy help` shows wrapper commands, not interactive slash commands
- `agy --version` is safe non-interactive; `agy version` is interactive and needs TTY
- First place to look for failures: `~/.gemini/antigravity-cli/log/cli-*.log`
- Don't confuse persistent JSON settings with launch-time overrides
- Workspace identity depends on launch directory and `.antigravitycli` project marker

## Verification

```bash
command -v agy
agy --version
agy help
agy plugin list
```
