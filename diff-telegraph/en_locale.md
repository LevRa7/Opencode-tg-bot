# Hermes Agent — User-Facing Strings (en)
# Source: /tmp/hermes-agent-src/
# Format: ## Section /n KEY: value /n ## Next section

# =============================================================================
# GATEWAY LIFECYCLE
# =============================================================================

Starting Hermes Gateway...: Starting Hermes Gateway...
Session storage: %s: Session storage: %s
Gateway running with %s platform(s): Gateway running with %s platform(s)
Gateway stopped: Gateway stopped
Gateway exiting cleanly: %s: Gateway exiting cleanly: %s
Gateway exiting with failure: %s: Gateway exiting with failure: %s
Gateway will continue running for cron job execution.: Gateway will continue running for cron job execution.
Press Ctrl+C to stop: Press Ctrl+C to stop
Received SIGTERM/SIGINT — initiating shutdown: Received SIGTERM/SIGINT — initiating shutdown
Shutdown diagnostic — no other hermes processes found: Shutdown diagnostic — no other hermes processes found
Skipping signal handlers (not running in main thread).: Skipping signal handlers (not running in main thread).
Active profile: %s: Active profile: %s
Session storage: %s: Session storage: %s
Gateway hit a non-retryable startup conflict: %s: Gateway hit a non-retryable startup conflict: %s
Gateway failed to connect any configured messaging platform: %s: Gateway failed to connect any configured messaging platform: %s
No messaging platforms enabled.: No messaging platforms enabled.
No connected messaging platforms remain. Shutting down gateway cleanly.: No connected messaging platforms remain. Shutting down gateway cleanly.
No connected messaging platforms remain. Shutting down gateway for service restart.: No connected messaging platforms remain. Shutting down gateway for service restart.
Press Ctrl+C to stop: Press Ctrl+C to stop

# =============================================================================
# PLATFORM CONNECTIONS
# =============================================================================

Connecting to %s...: Connecting to %s...
✓ %s connected: ✓ %s connected
✓ %s disconnected: ✓ %s disconnected
✓ %s reconnected successfully: ✓ %s reconnected successfully
✗ %s failed to connect: ✗ %s failed to connect
✗ %s error: %s: ✗ %s error: %s
✗ %s disconnect error: %s: ✗ %s disconnect error: %s
No adapter available for %s: No adapter available for %s
No adapter for platform %s in background task %s: No adapter for platform %s in background task %s
%s hook(s) loaded: %s hook(s) loaded
Channel directory built: %d target(s): Channel directory built: %d target(s)
Channel directory build failed: %s: Channel directory build failed: %s

# =============================================================================
# TELEGRAM ADAPTER
# =============================================================================

[%s] Connected to Telegram (%s mode): [%s] Connected to Telegram (%s mode)
[%s] Disconnected from Telegram: [%s] Disconnected from Telegram
[%s] Error during Telegram disconnect: %s: [%s] Error during Telegram disconnect: %s
[%s] Failed to connect to Telegram: %s: [%s] Failed to connect to Telegram: %s
[%s] Failed to send Telegram message: %s: [%s] Failed to send Telegram message: %s
[%s] No bot token configured: [%s] No bot token configured
[%s] Telegram polling error: %s: [%s] Telegram polling error: %s
[%s] Telegram polling reconnect failed: %s: [%s] Telegram polling reconnect failed: %s
[%s] Telegram polling resumed after conflict retry %d: [%s] Telegram polling resumed after conflict retry %d
[%s] Telegram polling retry failed: %s: [%s] Telegram polling retry failed: %s
[%s] Telegram network error, scheduling reconnect: %s: [%s] Telegram network error, scheduling reconnect: %s
[%s] Network error on send (attempt %d/3), retrying in %ds: %s: [%s] Network error on send (attempt %d/3), retrying in %ds: %s
[%s] MarkdownV2 parse failed, falling back to plain text: %s: [%s] MarkdownV2 parse failed, falling back to plain text: %s
[%s] Failed stopping Telegram polling after conflict: %s: [%s] Failed stopping Telegram polling after conflict: %s
[%s] Blocked unsafe image URL (SSRF protection): [%s] Blocked unsafe image URL (SSRF protection)
[%s] Config file not found at %s, cannot persist thread_id: [%s] Config file not found at %s, cannot persist thread_id
[%s] Failed to persist thread_id to config: %s: [%s] Failed to persist thread_id to config: %s
[%s] Failed to reload dm_topics from config: %s: [%s] Failed to reload dm_topics from config: %s
[%s] Ignoring invalid Telegram thread id: %r: [%s] Ignoring invalid Telegram thread id: %r
[%s] Ignoring non-numeric Telegram message_thread_id: %r: [%s] Ignoring non-numeric Telegram message_thread_id: %r
[%s] Invalid Telegram mention pattern %r: %s: [%s] Invalid Telegram mention pattern %r: %s
[%s] Loaded %d Telegram mention pattern(s): [%s] Loaded %d Telegram mention pattern(s)
[%s] Proxy detected; passing explicitly to HTTPXRequest: %s: [%s] Proxy detected; passing explicitly to HTTPXRequest: %s
[%s] Telegram fallback-IP transport disabled via env: [%s] Telegram fallback-IP transport disabled via env
[%s] %s Last error: %s: [%s] %s Last error: %s
[%s] %s Original error: %s: [%s] %s Original error: %s
Telegram update prompt answered '%s' by user %s: Telegram update prompt answered '%s' by user %s
Model picker switch failed: %s: Model picker switch failed: %s
Failed to resolve gateway approval from Telegram button: %s: Failed to resolve gateway approval from Telegram button: %s
Failed to write update response from callback: %s: Failed to write update response from callback: %s
[%s] send_exec_approval failed: %s: [%s] send_exec_approval failed: %s
[%s] send_model_picker failed: %s: [%s] send_model_picker failed: %s
[%s] send_slash_confirm failed: %s: [%s] send_slash_confirm failed: %s
[%s] send_update_prompt failed: %s: [%s] send_update_prompt failed: %s
[%s] slash-confirm callback failed: %s: [%s] slash-confirm callback failed: %s
[%s] set_message_reaction failed (%s): %s: [%s] set_message_reaction failed (%s): %s
[Telegram] Analyzing sticker at %s: [Telegram] Analyzing sticker at %s
[Telegram] Cached user audio at %s: [Telegram] Cached user audio at %s
[Telegram] Cached user document at %s: [Telegram] Cached user document at %s
[Telegram] Cached user photo at %s: [Telegram] Cached user photo at %s
[Telegram] Cached user video at %s: [Telegram] Cached user video at %s
[Telegram] Cached user video document at %s: [Telegram] Cached user video document at %s
[Telegram] Cached user voice at %s: [Telegram] Cached user voice at %s
[Telegram] Document too large: %s bytes: [Telegram] Document too large: %s bytes
[Telegram] Failed to cache audio: %s: [Telegram] Failed to cache audio: %s
[Telegram] Failed to cache document: %s: [Telegram] Failed to cache document: %s
[Telegram] Failed to cache photo: %s: [Telegram] Failed to cache photo: %s
[Telegram] Failed to cache video: %s: [Telegram] Failed to cache video: %s
[Telegram] Failed to cache voice: %s: [Telegram] Failed to cache voice: %s
[Telegram] Flushing photo batch %s with %d image(s): [Telegram] Flushing photo batch %s with %d image(s)
[Telegram] Sticker analysis error: %s: [Telegram] Sticker analysis error: %s
[Telegram] Sticker cache hit: %s: [Telegram] Sticker cache hit: %s
[Telegram] Unsupported document type: %s: [Telegram] Unsupported document type: %s
Telegram: python-telegram-bot not installed: Telegram: python-telegram-bot not installed
[%s] Post-stream file delivery failed: %s: [%s] Post-stream file delivery failed: %s
[%s] Post-stream image batch delivery failed: %s: [%s] Post-stream image batch delivery failed: %s
[%s] Post-stream media delivery failed: %s: [%s] Post-stream media delivery failed: %s

# =============================================================================
# SESSION MANAGEMENT
# =============================================================================

Created new agent for session %s (sig=%s): Created new agent for session %s (sig=%s)
Reusing cached agent for session %s: Reusing cached agent for session %s
SessionDB close error: %s: SessionDB close error: %s
Could not load messages from DB: %s: Could not load messages from DB: %s
Could not remove temp file %s: %s: Could not remove temp file %s: %s
Session DB end_session failed: %s: Session DB end_session failed: %s
Session DB operation failed: %s: Session DB operation failed: %s
Session DB reopen_session failed: %s: Session DB reopen_session failed: %s
Failed to rewrite transcript in DB: %s: Failed to rewrite transcript in DB: %s
Unknown platform value %r: %s: Unknown platform value %r: %s
SessionStore prune failed: %s: SessionStore prune failed: %s
Session expiry watcher error: %s: Session expiry watcher error: %s
Session suspension on startup failed: %s: Session suspension on startup failed: %s
Marked %d in-flight session(s) as resumable from previous run: Marked %d in-flight session(s) as resumable from previous run
Previous gateway exited cleanly — skipping session suspension: Previous gateway exited cleanly — skipping session suspension
Auto-suspended %d stuck-loop session(s): Auto-suspended %d stuck-loop session(s)
Stuck-loop detection failed: %s: Stuck-loop detection failed: %s

# =============================================================================
# AGENT EXECUTION
# =============================================================================

Agent error in session %s: Agent error in session %s
Agent notify injection error: %s: Agent notify injection error: %s
Interrupted running agent for session %s during shutdown: Interrupted running agent for session %s during shutdown
Failed interrupting agent during shutdown: %s: Failed interrupting agent during shutdown
Agent hit max_turns (%d) without finishing: Agent hit max_turns (%d) without finishing
Interrupt detected from adapter, signaling agent...: Interrupt detected from adapter, signaling agent...
STOP for session %s — agent interrupted, session lock released: STOP for session %s — agent interrupted, session lock released
STOP (pending) for session %s — sentinel cleared: STOP (pending) for session %s — sentinel cleared
HARD STOP (pending) for session %s — sentinel cleared: HARD STOP (pending) for session %s — sentinel cleared
PRIORITY interrupt for session %s: PRIORITY interrupt for session %s
PRIORITY steer for session %s: PRIORITY steer for session %s
PRIORITY steer-fallback-to-queue for session %s: PRIORITY steer-fallback-to-queue for session %s
PRIORITY steer failed for session %s: %s: PRIORITY steer failed for session %s: %s
Gateway steer failed for session %s: %s: Gateway steer failed for session %s: %s
Steer failed for session %s: %s: Steer failed for session %s: %s
Delivering leftover /steer as next turn: '%s...': Delivering leftover /steer as next turn: '%s...'
Processing pending message: '%s...': Processing pending message: '%s...'
Processing queued message after agent completion: '%s...': Processing queued message after agent completion: '%s...'
Delivered steer to running agent for session %s: Delivered steer to running agent for session %s
Could not set up stream consumer: %s: Could not set up stream consumer: %s

# =============================================================================
# PROVIDER / CREDENTIALS
# =============================================================================

Primary provider auth failed: %s — trying fallback: Primary provider auth failed: %s — trying fallback
Fallback provider resolved: %s: Fallback provider resolved: %s
Fallback entry %s failed: %s: Fallback entry %s failed: %s
In-place model switch failed for cached agent: %s: In-place model switch failed for cached agent: %s
Picker model switch failed for cached agent: %s: Picker model switch failed for cached agent: %s
Unknown reasoning_effort '%s', using default (medium): Unknown reasoning_effort '%s', using default (medium)
Unknown service_tier '%s', ignoring: Unknown service_tier '%s', ignoring

# =============================================================================
# APPROVAL / SECURITY
# =============================================================================

User approved %d dangerous command(s) via /approve%s: User approved %d dangerous command(s) via /approve%s
User denied %d dangerous command(s) via /deny: User denied %d dangerous command(s) via /deny
Failed to send approval request: %s: Failed to send approval request: %s
Gateway approval notify failed: %s: Gateway approval notify failed: %s
Unauthorized user: %s (%s) on %s: Unauthorized user: %s (%s) on %s
Unauthorized voice input from user %d, ignoring: Unauthorized voice input from user %d, ignoring
Hardline block: %s (command: %s): Hardline block: %s (command: %s)
Smart approval: auto-approved '%s' (%s): Smart approval: auto-approved '%s' (%s)
Smart approvals: LLM call failed (%s), escalating: Smart approvals: LLM call failed (%s), escalating
Failed to load approval config: %s: Failed to load approval config: %s
Failed to load permanent allowlist: %s: Failed to load permanent allowlist: %s
Could not save allowlist: %s: Could not save allowlist: %s
Approval callback failed: %s: Approval callback failed: %s
Approval hook %s dispatch failed: %s: Approval hook %s dispatch failed: %s

# =============================================================================
# UPDATE / PROCESS WATCHER
# =============================================================================

Update finished (exit=%s), notified %s: Update finished (exit=%s), notified %s
Update final notification failed: %s: Update final notification failed: %s
Update notification deferred: update still running: Update notification deferred: update still running
Update watcher timed out after %.0fs: Update watcher timed out after %.0fs
Update watcher: cannot resolve adapter/chat_id, falling back to completion-only: Update watcher: cannot resolve adapter/chat_id, falling back to completion-only
Watcher delivery error: %s: Watcher delivery error: %s
Process watcher started: %s (every %ss, notify=%s, agent_notify=%s): Process watcher started: %s (every %ss, notify=%s, agent_notify=%s)
Process watcher ended: %s: Process watcher ended: %s
Process watcher ended (silent): %s: Process watcher ended (silent): %s
Process watcher setup error: %s: Process watcher setup error: %s
Process checkpoint recovery: %s: Process checkpoint recovery: %s
Update stream send failed: %s: Update stream send failed: %s
Failed to write update response: %s: Failed to write update response: %s
Restart notification failed: %s: Restart notification failed: %s
Failed to launch detached gateway restart: %s: Failed to launch detached gateway restart: %s
Could not locate hermes binary for detached /restart: Could not locate hermes binary for detached /restart
Stale-code restart request failed: %s: Stale-code restart request failed: %s
Stale-code self-check failed: %s: Stale-code self-check failed: %s
Failed to create branch session: %s: Failed to create branch session: %s
Failed to write restart dedup marker: %s: Failed to write restart dedup marker: %s
Failed to write restart notify file: %s: Failed to write restart notify file: %s
Could not write takeover marker: %s: Could not write takeover marker: %s
Takeover marker check failed: %s: Takeover marker check failed: %s
Watch notification injection error: %s: Watch notification injection error: %s
Watch queue drain error: %s: Watch queue drain error: %s
Recovered watcher setup error: %s: Recovered watcher setup error: %s
Resumed watcher for recovered process %s: Resumed watcher for recovered process %s
Background task %s failed: Background task %s failed

# =============================================================================
# STREAMING / MEDIA
# =============================================================================

Stream consumer error: %s: Stream consumer error: %s
Stream send chunk error: %s: Stream send chunk error: %s
Stream send/edit error: %s: Stream send/edit error: %s
Fresh-final send failed, falling back to edit: %s: Fresh-final send failed, falling back to edit: %s
Segment-break tail flush error: %s: Segment-break tail flush error: %s
Commentary send error: %s: Commentary send error: %s
on_new_message callback error: on_new_message callback error
Post-stream media extraction failed: %s: Post-stream media extraction failed: %s
Auto-analyzing user image: %s: Auto-analyzing user image: %s
Auto voice reply failed: %s: Auto voice reply failed: %s
Auto voice reply TTS failed: %s: Auto voice reply TTS failed: %s
Transcribing user voice: %s: Transcribing user voice: %s
Transcription error: %s: Transcription error: %s
Vision auto-analysis error: %s: Vision auto-analysis error: %s
Image cache cleanup: removed %d stale file(s): Image cache cleanup: removed %d stale file(s)
Image cache cleanup error: %s: Image cache cleanup error: %s
Document cache cleanup: removed %d stale file(s): Document cache cleanup: removed %d stale file(s)
Document cache cleanup error: %s: Document cache cleanup error: %s
Progress message error: %s: Progress message error: %s
Failed to send busy-ack: %s: Failed to send busy-ack: %s
Busy ack suppressed for session %s: Busy ack suppressed for session %s
Failed to apply busy-input onboarding hint: %s: Failed to apply busy-input onboarding hint: %s
Stream consumer wait before queued message failed: %s: Stream consumer wait before queued message failed: %s
Failed to send first response before queued message: %s: Failed to send first response before queued message: %s
Proxy: could not set up stream consumer: %s: Proxy: could not set up stream consumer: %s
Runtime_footer build failed: %s: Runtime_footer build failed: %s
Trailing footer send failed: %s: Trailing footer send failed: %s
Long-running notification error: %s: Long-running notification error: %s
Could not render inline diff: %s: Could not render inline diff: %s
Auto-resize could not fit image under %.1f MB (best: %.1f MB): Auto-resize could not fit image under %.1f MB (best: %.1f MB)
Auto-resized image fits: %.1f MB (quality=%s, %dx%d): Auto-resized image fits: %.1f MB (quality=%s, %dx%d)
Auto-upgrade failed: %s. Run: uv pip install 'hindsight-client>=%s': Auto-upgrade failed: %s. Run: uv pip install 'hindsight-client>=%s'
Auto-recording browser session %s to %s: Auto-recording browser session %s to %s
Audio stream close timed out after %.1fs — forcing ahead: Audio stream close timed out after %.1fs — forcing ahead
Audio file not found: %s: Audio file not found: %s
Audio playback interrupted: Audio playback interrupted
AudioRecorder shut down: AudioRecorder shut down
Aggregator returned empty content, retrying once: Aggregator returned empty content, retrying once
Aggregation complete (%s characters): Aggregation complete (%s characters)
API call failed on turn %d (%.1fs): %s: API call failed on turn %d (%.1fs): %s
Agent-created skill blocked (dangerous findings): %s: Agent-created skill blocked (dangerous findings): %s
agent-browser CLI not found: %s: agent-browser CLI not found: %s
agent-browser close failed for task %s: %s: agent-browser close failed for task %s: %s

# =============================================================================
# CONFIG / MISSING DEPENDENCIES
# =============================================================================

Discord: discord.py not installed: Discord: discord.py not installed
Slack: slack-bolt not installed. Run: pip install 'hermes-agent[slack]': Slack: slack-bolt not installed. Run: pip install 'hermes-agent[slack]'
Matrix: mautrix not installed or credentials not set. Run: pip install 'mautrix[encryption]': Matrix: mautrix not installed or credentials not set. Run: pip install 'mautrix[encryption]'
Email: EMAIL_ADDRESS, EMAIL_PASSWORD, EMAIL_IMAP_HOST, or EMAIL_SMTP_HOST not set: Email: EMAIL_ADDRESS, EMAIL_PASSWORD, EMAIL_IMAP_HOST, or EMAIL_SMTP_HOST not set
Signal: SIGNAL_HTTP_URL or SIGNAL_ACCOUNT not configured: Signal: SIGNAL_HTTP_URL or SIGNAL_ACCOUNT not configured
SMS: aiohttp not installed or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set: SMS: aiohttp not installed or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set
WhatsApp: Node.js not installed or bridge not configured: WhatsApp: Node.js not installed or bridge not configured
WeCom: aiohttp not installed or WECOM_BOT_ID/SECRET not set: WeCom: aiohttp not installed or WECOM_BOT_ID/SECRET not set
WeComCallback: aiohttp/httpx not installed: WeComCallback: aiohttp/httpx not installed
Weixin: aiohttp/cryptography not installed: Weixin: aiohttp/cryptography not installed
DingTalk: dingtalk-stream not installed or DINGTALK_CLIENT_ID/SECRET not set: DingTalk: dingtalk-stream not installed or DINGTALK_CLIENT_ID/SECRET not set
QQBot: aiohttp/httpx missing or QQ_APP_ID/QQ_CLIENT_SECRET not configured: QQBot: aiohttp/httpx missing or QQ_APP_ID/QQ_CLIENT_SECRET not configured
Webhook: aiohttp not installed: Webhook: aiohttp not installed
Mattermost: MATTERMOST_TOKEN or MATTERMOST_URL not set, or aiohttp missing: Mattermost: MATTERMOST_TOKEN or MATTERMOST_URL not set, or aiohttp missing
HomeAssistant: aiohttp not installed or HASS_TOKEN not set: HomeAssistant: aiohttp not installed or HASS_TOKEN not set
BlueBubbles: aiohttp/httpx missing or BLUEBUBBLES_SERVER_URL/BLUEBUBBLES_PASSWORD not configured: BlueBubbles: aiohttp/httpx missing or BLUEBUBBLES_SERVER_URL/BLUEBUBBLES_PASSWORD not configured
Feishu: lark-oapi not installed or FEISHU_APP_ID/SECRET not set: Feishu: lark-oapi not installed or FEISHU_APP_ID/SECRET not set
API Server: aiohttp not installed: API Server: aiohttp not installed
Yuanbao: websockets not installed. Run: pip install websockets: Yuanbao: websockets not installed. Run: pip install websockets
Proxy connection error to %s: %s: Proxy connection error to %s: %s

# =============================================================================
# PREFILL / MODEL CONFIG
# =============================================================================

Prefill messages file not found: %s: Prefill messages file not found: %s
Prefill messages file must contain a JSON array: %s: Prefill messages file must contain a JSON array: %s
Failed to load prefill messages from %s: %s: Failed to load prefill messages from %s: %s

# =============================================================================
# RECOVERY / BACKGROUND
# =============================================================================

Recovered %s background process(es) from previous run: Recovered %s background process(es) from previous run
Released %d stale scoped lock(s) from old gateway.: Released %d stale scoped lock(s) from old gateway.
Idle agent sweep failed: %s: Idle agent sweep failed: %s
Cron ticker started (interval=%ds): Cron ticker started (interval=%ds)
Cron ticker stopped: Cron ticker stopped
Cron tick error: %s: Cron tick error: %s
Skills reload failed: %s: Skills reload failed: %s
MCP reload failed: %s: MCP reload failed: %s
MCP tool discovery failed: %s: MCP tool discovery failed: %s
Manual compress failed: %s: Manual compress failed: %s
Background memory/skill review failed: %s: Background memory/skill review failed: %s
Curator tick error: %s: Curator tick error: %s
Curator: %s: Curator: %s
Insights command error: %s: Insights command error: %s
[Gateway] Auto-skill '%s' not found: [Gateway] Auto-skill '%s' not found
[Gateway] Failed to auto-load skill(s) %s: %s: [Gateway] Failed to auto-load skill(s) %s: %s
Plugin command dispatch failed (non-fatal): %s: Plugin command dispatch failed (non-fatal): %s
Skill command check failed (non-fatal): %s: Skill command check failed (non-fatal): %s
agent:step hook error: %s: agent:step hook error: %s
@ context reference expansion failed: %s: @ context reference expansion failed: %s
goal manager unavailable: %s: goal manager unavailable: %s
goal manager: session lookup failed: %s: goal manager: session lookup failed: %s
goal continuation hook failed: %s: goal continuation hook failed: %s
goal continuation: enqueue failed: %s: goal continuation: enqueue failed: %s
goal continuation: status send failed: %s: goal continuation: status send failed: %s
goal continuation: goals module unavailable: %s: goal continuation: goals module unavailable: %s
goal kickoff enqueue failed: %s: goal kickoff enqueue failed: %s
interim_assistant_callback error: %s: interim_assistant_callback error: %s
status_callback error (%s): %s: status_callback error (%s): %s
background_review_callback error: %s: background_review_callback error: %s
Paste sweep error: %s: Paste sweep error: %s
Could not load gateway config from %s: Could not load gateway config from %s
Could not parse TERMINAL_DOCKER_VOLUMES for gateway media warning: Could not parse TERMINAL_DOCKER_VOLUMES for gateway media warning
SQLite session store not available: %s: SQLite session store not available: %s
State.db auto-maintenance skipped: %s: state.db auto-maintenance skipped: %s
Checkpoint auto-maintenance skipped: %s: checkpoint auto-maintenance skipped: %s
cleanup_all_browsers (%s) error: %s: cleanup_all_browsers (%s) error: %s
cleanup_all_environments (%s) error: %s: cleanup_all_environments (%s) error: %s
shutdown_cached_clients error: %s: shutdown_cached_clients error: %s
process_registry.kill_all (%s) error: %s: process_registry.kill_all (%s) error: %s
monitor_for_interrupt error (will retry): %s: monitor_for_interrupt error (will retry): %s
Skipping update notification watcher: no running event loop: Skipping update notification watcher: no running event loop
Forwarded update prompt to %s: %s: Forwarded update prompt to %s: %s
Failed to read update prompt: %s: Failed to read update prompt: %s
Failed to persist model switch: %s: Failed to persist model switch: %s
Failed to persist mcp_reload_confirm=false: %s: Failed to persist mcp_reload_confirm=false: %s
Failed to save config key %s: %s: Failed to save config key %s: %s
Failed to save runtime_footer.enabled: %s: Failed to save runtime_footer.enabled: %s
Failed to save tool_progress mode: %s: Failed to save tool_progress mode: %s
Failed to save voice modes: %s: Failed to save voice modes: %s
Failed to list titled sessions: %s: Failed to list titled sessions: %s
Failed to resolve resume continuation for %s: %s: Failed to resolve resume continuation for %s: %s
channel_forward: session lookup failed: %s: channel_forward: session lookup failed: %s
channel_forward: forwarding to %d session(s): channel_forward: forwarding to %d session(s)
Failed to auto-reply with session list: %s: Failed to auto-reply with session list: %s
Error leaving voice channel: %s: Error leaving voice channel: %s
Failed to join voice channel: %s: Failed to join voice channel: %s
Platform registry lookup for '%s' failed: %s: Platform registry lookup for '%s' failed: %s
button_update_prompt: no session found for %s: button_update_prompt: no session found for %s
PRIORITY photo follow-up for session %s — queueing without interrupt: PRIORITY photo follow-up for session %s — queueing without interrupt
PRIORITY queue follow-up for session %s: PRIORITY queue follow-up for session %s
tool-progress onboarding hint failed: %s: tool-progress onboarding hint failed: %s
Auto-reset notification failed (non-fatal): %s: Auto-reset notification failed (non-fatal): %s
Button-based update prompt failed: %s: Button-based update prompt failed: %s
Inactivity warning send error: %s: Inactivity warning send error: %s
Post-update notification failed: %s: Post-update notification failed: %s
Image routing: decision failed, falling back to text — %s: image_routing: decision failed, falling back to text — %s
Ignored message with no user_id from %s: Ignoring message with no user_id from %s
Added https:// prefix to URL: %s: Added https:// prefix to URL: %s
Auto-repaired jobs.json (had invalid control characters): Auto-repaired jobs.json (had invalid control characters)
Auto-mapped ssrc=%d -> user=%d (sole allowed member): Auto-mapped ssrc=%d -> user=%d (sole allowed member)
Auto-extracted %d facts from conversation: Auto-extracted %d facts from conversation
Analyzing image: %s: Analyzing image: %s
Analyzing video: %s: Analyzing video: %s
ACP steer failed for session %s: %s: ACP steer failed for session %s: %s
ACP client connected: ACP client connected
[bluebubbles] webhook parse error: %s: [bluebubbles] webhook parse error: %s
Batch worker failed: %s: Batch worker failed: %s
Auth failed: %s: Auth failed: %s
Auto-detected Codex provider but credentials failed: Auto-detected Codex provider but credentials failed; Auto-detected Nous provider but credentials failed; Auxiliary auto-detect: no provider available (tried: %s). Auxiliary auto-detect: using main provider %s (%s)
Auxiliary auto-detect: using %s (%s)%s: Auxiliary auto-detect: using %s (%s)%s
Auxiliary %s: provider %s unavailable, trying auto-detection chain: Auxiliary %s: provider %s unavailable, trying auto-detection chain
Auxiliary %s: %s on %s (%s), trying fallback: Auxiliary %s: %s on %s (%s), trying fallback
Auxiliary %s (async): refreshed Nous runtime credentials after 401, retrying: Auxiliary %s (async): refreshed Nous runtime credentials after 401, retrying
Auxiliary %s: refreshed Nous runtime credentials after 401, retrying: Auxiliary %s: refreshed Nous runtime credentials after 401, retrying
boot-md agent failed: %s: boot-md agent failed: %s
boot-md completed (nothing to report): boot-md completed (nothing to report)
boot-md completed: %s: boot-md completed: %s
background proc %s: %s: background proc %s: %s
auto_gateway_reconnect failed: %s: auto_gateway_reconnect failed: %s
Blocked crawled page %s by rule %s: Blocked crawled page %s by rule %s
Blocked redirected web_extract for %s by rule %s: Blocked redirected web_extract for %s by rule %s
Blocked request — DNS resolution failed for: %s: Blocked request — DNS resolution failed for: %s
Blocked request to internal hostname: %s: Blocked request to internal hostname: %s
Blocked request — URL safety check error for %s: %s: Blocked request — URL safety check error for %s: %s
Blocked URL %s — matched rule '%s' from %s: Blocked URL %s — matched rule '%s' from %s
Blocked web_crawl for %s by rule %s: Blocked web_crawl for %s by rule %s
Blocked web_extract for %s by rule %s: Blocked web_extract for %s by rule %s
Could not load messages from DB: %s: Could not load messages from DB: %s

# =============================================================================
# KANBAN
# =============================================================================

kanban notifier: kanban_db not importable; notifier disabled: kanban notifier: kanban_db not importable; notifier disabled
kanban notifier tick failed: %s: kanban notifier tick failed: %s
kanban dispatcher: kanban_db not importable; dispatcher disabled: kanban dispatcher: kanban_db not importable; dispatcher disabled
kanban dispatcher: config loader unavailable; disabled: kanban dispatcher: config loader unavailable; disabled
kanban dispatcher: cannot load config (%s); disabled: kanban dispatcher: cannot load config (%s); disabled
kanban dispatcher: disabled via HERMES_KANBAN_DISPATCH_IN_GATEWAY env: kanban dispatcher: disabled via HERMES_KANBAN_DISPATCH_IN_GATEWAY env
kanban create auto-subscribe failed: %s: kanban create auto-subscribe failed: %s
Kanban dispatcher: cancelled: Kanban dispatcher: cancelled
kanban dispatcher: tick failed on board %s: kanban dispatcher: tick failed on board %s
kanban dispatcher: unexpected watcher error: kanban dispatcher: unexpected watcher error

# =============================================================================
# TOOL ACTIVITY LABELS (CLI TUI — agent/display.py)
# These are f-strings with template vars: {args.get(...)} {_trunc(...)} {dur}
# The non-variable parts are the labels/verbs.
# Variables shown in {} are NOT replaced — they show what the template contains.
# =============================================================================

Terminal (running command): 💻 $         {command}  {dur}
Terminal (process action): ⚙️  proc      {action}  {dur}
Read file: 📖 read      {path}  {dur}
Write file: ✍️  write     {path}  {dur}
Patch file: 🔧 patch     {path}  {dur}
Search content: 🔎 {verb} {pattern}  {dur}
Search files: 🔎 find    {pattern}  {dur}
Web search: 🔍 search    {query}  {dur}
Web fetch: 📄 fetch     {domain}  {dur}
Web crawl: 🕸️  crawl     {domain}  {dur}
Browser navigate: 🌐 navigate  {domain}  {dur}
Browser snapshot: 📸 snapshot  {mode}  {dur}
Browser click: 👆 click     {ref}  {dur}
Browser type: ⌨️  type      "{text}"  {dur}
Browser scroll: {arrow}  scroll    {direction}  {dur}
Browser back: ◀️  back      {dur}
Browser press: ⌨️  press     {key}  {dur}
Browser vision: 👁️  vision    {question}  {dur}
Browser vision (page): 👁️  vision    analyzing page  {dur}
Image generation: 🎨 create    {prompt}  {dur}
Skill load: 📚 skill     {name}  {dur}
Skills list: 📚 skills    list {category}  {dur}
Plan read: 📋 plan      reading tasks  {dur}
Plan update: 📋 plan      update {count} task(s)  {dur}
Plan create: 📋 plan      {count} task(s)  {dur}
Delegate: 🔀 delegate  {goal}  {dur}
Delegate parallel: 🔀 delegate  {count} parallel tasks  {dur}
Cron create: ⏰ cron      create {label}  {dur}
Cron list: ⏰ cron      listing  {dur}
Cron action: ⏰ cron      {action} {job_id}  {dur}
Memory: 🧠 memory    {action}  {dur}
Reason: 🧠 reason    {prompt}  {dur}
Speak: 🔊 speak     {text}  {dur}
RL training: 🧪 rl        {tool_name}  {dur}
Generic tool: ⚡ {tool_name} {preview}  {dur}
Python exec: 🐍 exec      {first_line}  {dur}
Images extract: 🖼️  images    extracting  {dur}

# =============================================================================
# SLASH COMMAND DESCRIPTIONS (hermes_cli/commands.py)
# =============================================================================

Hermes Gateway - Multi-platform messaging: Hermes Gateway - Multi-platform messaging
