# tg-cli

[![CI](https://github.com/jackwener/tg-cli/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jackwener/tg-cli/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/kabi_tg_cli)](https://pypi.org/project/kabi-tg-cli/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

> **PyPI package name:** [`kabi-tg-cli`](https://pypi.org/project/kabi-tg-cli/) — install with `uv tool install kabi-tg-cli`

Telethon-powered Telegram CLI for local-first sync, search, export, and agent-friendly retrieval.

## More Projects

- [xiaohongshu-cli](https://github.com/jackwener/xiaohongshu-cli) — Xiaohongshu (小红书) CLI for notes and account workflows
- [twitter-cli](https://github.com/jackwener/twitter-cli) — Twitter/X CLI for timelines, search, and posting
- [bilibili-cli](https://github.com/jackwener/bilibili-cli) — Bilibili CLI for videos, users, search, and feeds
- [discord-cli](https://github.com/jackwener/discord-cli) — Discord CLI for local-first sync, search, and export

[English](#english) | [中文](#中文)

## English

tg-cli uses your own Telegram account over MTProto, not the Bot API. It syncs messages into local
SQLite so humans and AI agents can query the same cache quickly with `--json` or `--yaml`.

## Features

- Sync Telegram dialogs into a local SQLite cache
- Search by keyword or regex, with chat, sender, and time filters
- Browse recent messages, today's messages, top senders, and timelines
- Export messages as text, JSON, or YAML
- Keep a near-real-time cache with `tg listen --persist`
- Prefer YAML for AI agents when a strict JSON parser is not required
- Default to YAML automatically on non-TTY stdout; override with `OUTPUT=yaml|json|rich|auto`
- Structured output contract: [SCHEMA.md](./SCHEMA.md)

## Installation

```bash
# Recommended: uv tool
uv tool install kabi-tg-cli

# Or: pipx / pip
pipx install kabi-tg-cli
pip install kabi-tg-cli
```

Upgrade to the latest version:

```bash
uv tool upgrade kabi-tg-cli
# Or: pipx upgrade kabi-tg-cli
```

> **Tip:** Upgrade regularly to avoid unexpected errors from outdated API handling.

Install from GitHub:

```bash
uv tool install git+https://github.com/jackwener/tg-cli.git
```

Install from source:

```bash
git clone git@github.com:jackwener/tg-cli.git
cd tg-cli
uv sync --extra dev
```

## Quick Start

```bash
# First login (uses Telegram Desktop built-in credentials by default)
tg login-start +123456789 --json
tg login-complete +123456789 12345 --phone-code-hash <hash> --json
tg login-password --password 'secret' --json
tg login-qr --wait-timeout 60 --json

# Check the current account
tg status
tg whoami

# Refresh the local cache
tg refresh

# Read and search
tg today
tg recent --hours 24 --limit 20 --yaml
tg search "Rust" --hours 48
tg filter "Rust,Golang,remote" --hours 48 --sync-first --yaml

# Keep a near-real-time cache
tg listen --persist
```


Auth notes:
- `login-complete` may return `data.password_required: true` and `data.next_step: login-password`.
- `login-password` may return `data.auth_key_unregistered: true` and `data.next_step: login-start`.
- `login-qr --json` streams QR events; send `png_path` when `qr_ready` arrives.


## Refresh Model

tg-cli is intentionally local-first:

- `tg refresh` is the recommended daily entrypoint
- `tg sync-all` is the lower-level primitive for scripts and schedulers
- `--sync-first` refreshes before a single query
- `tg listen --persist` reconnects automatically for a near-live cache

Most query commands read from local SQLite, not directly from Telegram.

## Command Reference

### Telegram Operations

```bash
tg chats
tg history CHAT -n 1000
tg sync CHAT
tg sync-all
tg refresh
tg listen
tg listen --persist
tg info CHAT
tg login-start +123456789 --json
tg login-complete +123456789 12345 --phone-code-hash <hash> --json
tg login-password --password 'secret' --json
tg login-qr --wait-timeout 60 --json
tg whoami
tg status
tg send CHAT "Hello!"
tg edit CHAT MSG_ID "New text"
tg delete CHAT MSG_ID [MSG_ID...]
```

Auth flow for agents or scripts:
- `login-start` returns `phone_code_hash`.
- `login-complete` may return `data.password_required: true` and `data.next_step: login-password`.
- `login-password` may return `data.auth_key_unregistered: true` and `data.next_step: login-start`.
- `login-qr --json` streams `qr_ready` and `qr_rotated` events.
- QR login may also return `data.password_required: true` or `data.auth_key_unregistered: true`; follow `data.next_step`.
- Do not restart auth with `tg chats` / `tg status` mid-flow.
- Send the QR image at `png_path` as soon as `qr_ready` arrives.

### Query & Analysis

```bash
tg search "Rust"
tg search "Rust|Golang" --regex --hours 72
tg recent --hours 24 --limit 20 --yaml
tg stats --sync-first
tg top --hours 24 --sync-first
tg timeline --by hour --sync-first
tg today --sync-first
tg filter "Rust,Golang,remote" --hours 48 --sync-first --yaml
```

### Data Management

```bash
tg export "GroupName" -f yaml -o messages.yaml
tg purge "GroupName" -y
```

### Session Analysis

```bash
tg session-build CHAT
tg session-build-all
tg session-show CHAT
tg session-segments CHAT
tg session-facts CHAT
tg session-compact CHAT
tg ask CHAT "question"
tg projection CHAT "question"
tg subject-show CHAT
tg events CHAT
tg interaction-metrics CHAT
tg session-reset CHAT -y
```


## Scheduling

If you do not want to run `tg refresh` manually, use a scheduler.

### cron

See [examples/tg-refresh.cron](https://github.com/jackwener/tg-cli/blob/main/examples/tg-refresh.cron).

### systemd user timer

See:

- [tg-refresh.service](https://github.com/jackwener/tg-cli/blob/main/examples/systemd/tg-refresh.service)
- [tg-refresh.timer](https://github.com/jackwener/tg-cli/blob/main/examples/systemd/tg-refresh.timer)

Typical flow:

```bash
mkdir -p ~/.config/systemd/user
cp examples/systemd/tg-refresh.service ~/.config/systemd/user/
cp examples/systemd/tg-refresh.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tg-refresh.timer
```

## Use as AI Agent Skill

tg-cli ships with a [`SKILL.md`](./SKILL.md) for AI agent integration.

### Agent Output Recommendation

If an AI agent needs machine-readable output, prefer `--yaml` first:

- `--yaml` is usually more token-efficient than pretty-printed JSON
- It is still easy to parse for agents and scripts
- Keep `--json` for `jq`, strict JSON-only tooling, or exact downstream schemas
- Non-TTY stdout defaults to YAML automatically
- Use `OUTPUT=yaml|json|rich|auto` to override the default mode

Recommended agent workflow:

```bash
tg refresh --yaml
tg chats --yaml
tg recent --hours 24 --sync-first --yaml
tg search "keyword" --chat "GroupName" --sync-first --yaml
```

### [Skills CLI](https://github.com/vercel-labs/skills) (Recommended)

```bash
npx skills add jackwener/tg-cli
```

| Flag | Description |
| --- | --- |
| `-g` | Install globally (user-level, shared across projects) |
| `-a claude-code` | Target a specific agent |
| `-y` | Non-interactive mode |

### Manual Install

```bash
mkdir -p .agents/skills
git clone git@github.com:jackwener/tg-cli.git .agents/skills/tg-cli
```

### ~~OpenClaw / ClawHub~~ (Deprecated)

> ⚠️ ClawHub install method is deprecated and no longer supported. Use [Skills CLI](#skills-cli-recommended) or Manual Install above.

## ⚠️ Account Safety

tg-cli uses your personal Telegram account via MTProto. To reduce the risk of account restrictions:

1. **Get your own API credentials** — Go to [my.telegram.org](https://my.telegram.org), create an app, and set:
   ```bash
   export TG_API_ID=12345678
   export TG_API_HASH="your_api_hash_here"
   ```
   The default `api_id=2040` (Telegram Desktop) is shared by many third-party tools and may attract stricter scrutiny.

2. **Limit sync frequency** — Avoid running `tg refresh` more than 1–2 times per day.

3. **Use `--delay` and `--max-chats`** — Both `refresh` and `sync-all` support:
   - `--delay 3.0` — seconds between each chat sync (default: 2.0, with ±20% jitter)
   - `--max-chats 30` — only sync the first N chats per run

4. **Prefer established accounts** — New or rarely-used accounts are more likely to be flagged.

5. **Prefer read-only operations** — `tg send` carries higher risk than read commands.

## Troubleshooting

- `No messages today`
  - Run `tg refresh` first, or use `tg today --sync-first`.
- `Chat '...' not found in database`
  - Run `tg refresh` first, or use the numeric `chat_id` from `tg chats --yaml`.
- Repeatedly running `sync-all`
  - Prefer `tg refresh` for daily use, `--sync-first` for single queries, or `tg listen --persist`.

## 中文

`tg-cli` 是一个基于 Telethon 的 Telegram CLI。它不是 Bot API 工具，而是使用你自己的
Telegram 账号走 MTProto，把消息同步到本地 SQLite，方便你在终端里做搜索、筛选、导出，
也方便 AI agent 直接把它当作本地 retrieval tool 调用。

## 功能特性

- 同步 Telegram dialogs 到本地 SQLite
- 支持关键词搜索和 regex 搜索，可按 chat、sender、时间窗口过滤
- 支持 `recent`、`today`、`top`、`timeline` 等本地分析命令
- 支持导出为 text、JSON、YAML
- 支持 `tg listen --persist`，维持近实时本地缓存
- 支持登录流程 `login-start` / `login-complete` / `login-password` / `login-qr`
- 支持 `--json` / `--yaml`，其中 AI agent 更推荐 `--yaml`
- stdout 不是 TTY 时默认自动输出 YAML，也可以用 `OUTPUT=yaml|json|rich|auto` 覆盖

## 安装

```bash
# 推荐：uv tool
uv tool install kabi-tg-cli

# 或者：pipx / pip
pipx install kabi-tg-cli
pip install kabi-tg-cli
```

升级到最新版本：

```bash
uv tool upgrade kabi-tg-cli
# 或：pipx upgrade kabi-tg-cli
```

> **提示：** 建议定期升级，避免因版本过旧导致的 API 调用异常。

从 GitHub 安装：

```bash
uv tool install git+https://github.com/jackwener/tg-cli.git
```

从源码安装：

```bash
git clone git@github.com:jackwener/tg-cli.git
cd tg-cli
uv sync --extra dev
```

## 快速开始

```bash
# 首次登录（默认使用 Telegram Desktop 内置的 API 凭证）
tg login-start +123456789 --json
tg login-complete +123456789 12345 --phone-code-hash <hash> --json
tg login-password --password 'secret' --json
tg login-qr --wait-timeout 60 --json

# 检查当前账号
tg status
tg whoami

# 刷新本地缓存
tg refresh

# 浏览和搜索
tg today
tg recent --hours 24 --limit 20 --yaml
tg search "Rust" --hours 48
tg filter "招聘,remote,Web3" --hours 48 --sync-first --yaml

# 保持近实时缓存
tg listen --persist
```

登录说明：
- `login-complete` 可能返回 `data.password_required: true` 和 `data.next_step: login-password`。
- `login-password` 可能返回 `data.auth_key_unregistered: true` 和 `data.next_step: login-start`。
- `login-qr --json` 会流式输出二维码事件；收到 `qr_ready` 就发送 `png_path`。

## 刷新模型

`tg-cli` 是 local-first 设计：

- `tg refresh`
  - 推荐的日常入口，刷新所有当前 dialogs
- `tg sync-all`
  - 更底层的同步原语，适合脚本和调度器
- `--sync-first`
  - 单次查询前先刷新，适合 `today`、`search`、`recent`
- `tg listen --persist`
  - 常驻监听并自动重连，适合做近实时本地缓存

大多数查询命令默认读本地 SQLite，而不是每次都直接请求 Telegram。

## 命令总览

### Telegram 操作

```bash
tg chats
tg history CHAT -n 1000
tg sync CHAT
tg sync-all
tg refresh
tg listen
tg listen --persist
tg info CHAT
tg login-start +123456789 --yaml
tg login-complete +123456789 12345 --phone-code-hash <hash> --yaml
tg login-password --password 'secret' --yaml
tg login-qr --wait-timeout 60 --yaml
tg whoami
tg status
tg send CHAT "Hello!"
tg edit CHAT MSG_ID "New text"
tg delete CHAT MSG_ID [MSG_ID...]
```

### 查询与分析

```bash
tg search "Rust"
tg search "Rust|Golang" --regex --hours 72
tg recent --hours 24 --limit 20 --yaml
tg stats --sync-first
tg top --hours 24 --sync-first
tg timeline --by hour --sync-first
tg today --sync-first
tg filter "Rust,Golang,remote" --hours 48 --sync-first --yaml
```

### 数据管理

```bash
tg export "群名" -f yaml -o messages.yaml
tg purge "群名" -y
```

### Session 分析

```bash
tg session-build CHAT
tg session-build-all
tg session-show CHAT
tg session-segments CHAT
tg session-facts CHAT
tg session-compact CHAT
tg ask CHAT "question"
tg projection CHAT "question"
tg subject-show CHAT
tg events CHAT
tg interaction-metrics CHAT
tg session-reset CHAT -y
```


## 定时刷新

如果你不想每次手动执行 `tg refresh`，可以配合调度器。

### cron

参考 [examples/tg-refresh.cron](https://github.com/jackwener/tg-cli/blob/main/examples/tg-refresh.cron)。

### systemd user timer

参考：

- [tg-refresh.service](https://github.com/jackwener/tg-cli/blob/main/examples/systemd/tg-refresh.service)
- [tg-refresh.timer](https://github.com/jackwener/tg-cli/blob/main/examples/systemd/tg-refresh.timer)

典型流程：

```bash
mkdir -p ~/.config/systemd/user
cp examples/systemd/tg-refresh.service ~/.config/systemd/user/
cp examples/systemd/tg-refresh.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tg-refresh.timer
```

## 作为 AI Agent Skill 使用

`tg-cli` 自带 [`SKILL.md`](./SKILL.md)，方便 AI agent 自动学习并调用。

### Agent 输出建议

如果下游不是严格要求 JSON，优先使用 `--yaml`：

- `--yaml` 通常比 pretty-printed JSON 更省 token
- 对 agent 和脚本来说依然容易解析
- 只有在 `jq` 或严格 JSON-only tooling 场景下再优先用 `--json`
- stdout 不是 TTY 时会默认自动输出 YAML
- 也可以用 `OUTPUT=yaml|json|rich|auto` 强制覆盖默认输出模式

推荐的 agent 调用顺序：

```bash
tg refresh --yaml
tg chats --yaml
tg recent --hours 24 --sync-first --yaml
tg search "keyword" --chat "GroupName" --sync-first --yaml
```

### [Skills CLI](https://github.com/vercel-labs/skills)（推荐）

```bash
npx skills add jackwener/tg-cli
```

| 参数 | 说明 |
| --- | --- |
| `-g` | 全局安装（用户级别，跨项目共享） |
| `-a claude-code` | 指定目标 Agent |
| `-y` | 非交互模式 |

### 手动安装

```bash
mkdir -p .agents/skills
git clone git@github.com:jackwener/tg-cli.git .agents/skills/tg-cli
```

### ~~OpenClaw / ClawHub~~（已过时）

> ⚠️ ClawHub 安装方式已过时，不再支持。请使用上方的 Skills CLI 或手动安装。

## ⚠️ 账号安全

`tg-cli` 使用你的个人 Telegram 账号走 MTProto。为了降低账号被风控的风险：

1. **申请自己的 API 凭证** — 前往 [my.telegram.org](https://my.telegram.org)，创建应用后设置：
   ```bash
   export TG_API_ID=12345678
   export TG_API_HASH="your_api_hash_here"
   ```
   默认的 `api_id=2040`（Telegram Desktop）被大量第三方工具共用，风控更严格。

2. **控制同步频率** — 避免每天执行 `tg refresh` 超过 1-2 次。

3. **使用 `--delay` 和 `--max-chats`** — `refresh` 和 `sync-all` 支持：
   - `--delay 3.0` — 每个 chat 同步间隔秒数（默认 2.0，±20% 随机抖动）
   - `--max-chats 30` — 每次最多同步前 N 个 chat

4. **优先使用老号** — 新注册或长期未活跃的账号更容易被标记。

5. **优先只读操作** — `tg send` 比读取类命令风险更高。

## 常见问题

- `No messages today`
  - 先执行 `tg refresh`，或直接使用 `tg today --sync-first`
- `Chat '...' not found in database`
  - 先执行 `tg refresh`，或用 `tg chats --yaml` 找到准确的 `chat_id`
- 登录卡住 / 一直要重试
  - 检查 `login-complete` 的 `data.next_step`；2FA 就继续 `login-password`，如果返回 `auth_key_unregistered` 就重新 `login-start`
- 为什么总要先同步
  - 因为 `tg-cli` 是 local-first 设计，大多数查询命令默认读本地 SQLite，不直接查 Telegram

## 推荐项目

- [twitter-cli](https://github.com/jackwener/twitter-cli) — Twitter/X 时间线、搜索与发帖 CLI
- [bilibili-cli](https://github.com/jackwener/bilibili-cli) — Bilibili 视频、用户、搜索与动态 CLI
- [discord-cli](https://github.com/jackwener/discord-cli) — Discord 本地优先同步、检索与导出 CLI

## License

Apache-2.0
