#!/usr/bin/env bash
# health-check.sh — Monitor bot health, restart if down, notify user via Telegram.
#
# Checks:
#   1. systemd service active state
#   2. Port 8080 listening
#   3. HTTP 200 from /health (if endpoint available)
#
# After FAIL_THRESHOLD consecutive failures → restart service + notify user.
# State file prevents duplicate notifications within COOLDOWN seconds.

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${TELEGRAM_ADMIN_CHAT_ID:-6931112349}"
SERVICE_NAME="opencode-telegram-bot"
PORT=8080
HEALTH_URL="http://localhost:${PORT}/health"
CHECK_INTERVAL=30          # seconds between checks
FAIL_THRESHOLD=3            # consecutive failures before restart
NOTIFY_COOLDOWN=600         # seconds between duplicate notifications (10 min)
STATE_DIR="${HOME}/.local/state/opencode-tg"
STATE_FILE="${STATE_DIR}/health-check.state"
LOG_FILE="${STATE_DIR}/health-check.log"

# ── Init ───────────────────────────────────────────────────────────────────
mkdir -p "$STATE_DIR"

log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

# ── State ──────────────────────────────────────────────────────────────────
read_state() {
    if [[ -f "$STATE_FILE" ]]; then
        source "$STATE_FILE"
    fi
    FAIL_COUNT="${FAIL_COUNT:-0}"
    LAST_RESTART="${LAST_RESTART:-0}"
    LAST_NOTIFY="${LAST_NOTIFY:-0}"
}

write_state() {
    cat > "$STATE_FILE" <<EOF
FAIL_COUNT=$FAIL_COUNT
LAST_RESTART=$LAST_RESTART
LAST_NOTIFY=$LAST_NOTIFY
EOF
}

# ── Health checks ─────────────────────────────────────────────────────────
check_systemd() {
    systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null
}

check_port() {
    ss -tlnp 2>/dev/null | grep -q ":${PORT} "
}

check_http() {
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")
    [[ "$code" == "200" ]]
}

# ── Notification ───────────────────────────────────────────────────────────
notify_user() {
    local status="$1"
    local now
    now=$(date +%s)

    # Cooldown: don't spam
    if (( now - LAST_NOTIFY < NOTIFY_COOLDOWN )); then
        log "NOTIFY skipped (cooldown, last=$(date -d "@$LAST_NOTIFY" +%H:%M:%S))"
        return
    fi

    if [[ -z "$BOT_TOKEN" ]]; then
        log "NOTIFY skipped (no BOT_TOKEN)"
        return
    fi

    local message
    if [[ "$status" == "restarted" ]]; then
        message="🔄 Бот перезапущен health-check'ом.

Сервис: ${SERVICE_NAME}
Порт: ${PORT}
Время: $(date -u +%H:%M:%S UTC)
Причина: ${FAIL_COUNT} проверок подряд не пройдены"
    else
        message="⚠️ Бот недоступен (health-check).

Сервис: ${SERVICE_NAME}
Порт: ${PORT}
Время: $(date -u +%H:%M:%S UTC)
Попыток: ${FAIL_COUNT}/${FAIL_THRESHOLD}"
    fi

    local resp
    resp=$(curl -s --max-time 10 \
        -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "$(jq -nc --arg chat "$CHAT_ID" --arg text "$message" \
            '{chat_id: ($chat|tonumber), text: $text, parse_mode: "HTML"}')" 2>/dev/null || true)

    if echo "$resp" | jq -e '.ok' >/dev/null 2>&1; then
        log "NOTIFY sent to chat $CHAT_ID"
        LAST_NOTIFY=$now
    else
        log "NOTIFY failed: ${resp:-curl error}"
    fi
}

# ── Restart ────────────────────────────────────────────────────────────────
restart_service() {
    log "RESTART: stopping $SERVICE_NAME"
    systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
    sleep 3

    log "RESTART: starting $SERVICE_NAME"
    systemctl --user start "$SERVICE_NAME" 2>/dev/null || true
    sleep 5

    LAST_RESTART=$(date +%s)
    FAIL_COUNT=0
    write_state

    notify_user "restarted"
}

# ── Main ───────────────────────────────────────────────────────────────────
main() {
    read_state
    log "CHECK: systemd=$(check_systemd && echo ok || echo fail) port=$(check_port && echo ok || echo fail)"

    local healthy=false

    # Check 1: systemd service
    if check_systemd; then
        # Check 2: port listening
        if check_port; then
            healthy=true
        fi
    fi

    if $healthy; then
        if (( FAIL_COUNT > 0 )); then
            log "RECOVERED after $FAIL_COUNT failures"
        fi
        FAIL_COUNT=0
        write_state
        return 0
    fi

    # Unhealthy
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "FAIL ($FAIL_COUNT/$FAIL_THRESHOLD)"

    if (( FAIL_COUNT >= FAIL_THRESHOLD )); then
        log "THRESHOLD reached — restarting"
        write_state
        restart_service
        return 0
    fi

    # Notify on first failure
    if (( FAIL_COUNT == 1 )); then
        notify_user "down"
    fi

    write_state
    return 0
}

main "$@"
