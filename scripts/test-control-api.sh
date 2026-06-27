#!/usr/bin/env bash
# Test script for Bot Control API
# Usage: ./scripts/test-control-api.sh [API_KEY]
#
# Set BOT_CONTROL_API_KEY env var or pass as first argument.
# Default: reads from env, or uses empty (server will generate one on startup).

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
API_KEY="${1:-${BOT_CONTROL_API_KEY:-}}"
CT="Content-Type: application/json"

if [ -z "$API_KEY" ]; then
  echo "⚠️  No API key provided. Set BOT_CONTROL_API_KEY env var or pass as arg."
  echo "   The server logs the generated key at startup."
  echo "   Continuing anyway (will likely 401)..."
fi

header() {
  echo
  echo "══════════════════════════════════════════════"
  echo "  $1"
  echo "══════════════════════════════════════════════"
}

# ─── Health Check ────────────────────────────────────────────────────────

header "GET /api/control/health"
curl -s "$BASE_URL/api/control/health" \
  -H "$CT" \
  -H "X-API-Key: $API_KEY" | python3 -m json.tool 2>/dev/null || echo "(no json)"

# ─── Get Bot State ────────────────────────────────────────────────────────

header "GET /api/control/state"
curl -s "$BASE_URL/api/control/state" \
  -H "$CT" \
  -H "X-API-Key: $API_KEY" | python3 -m json.tool 2>/dev/null || echo "(no json)"

# ─── List Sessions ────────────────────────────────────────────────────────

header "GET /api/control/sessions"
curl -s "$BASE_URL/api/control/sessions" \
  -H "$CT" \
  -H "X-API-Key: $API_KEY" | python3 -m json.tool 2>/dev/null || echo "(no json)"

# ─── Send Message ─────────────────────────────────────────────────────────
# NOTE: chat_id must be a valid Telegram chat ID.
# Replace 0 with your actual chat ID for testing.

header "POST /api/control/message"
curl -s -X POST "$BASE_URL/api/control/message" \
  -H "$CT" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "chat_id": 0,
    "text": "Test message from Control API 🚀",
    "parse_mode": "MarkdownV2"
  }' | python3 -m json.tool 2>/dev/null || echo "(no json)"

# ─── Send Keyboard ────────────────────────────────────────────────────────

header "POST /api/control/keyboard"
curl -s -X POST "$BASE_URL/api/control/keyboard" \
  -H "$CT" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "chat_id": 0,
    "text": "Choose an option:",
    "keyboard": [
      [{"text": "✅ Approve", "callback_data": "approve"}, {"text": "❌ Reject", "callback_data": "reject"}],
      [{"text": "🔗 Open Site", "url": "https://example.com"}]
    ]
  }' | python3 -m json.tool 2>/dev/null || echo "(no json)"

# ─── Send Poll ────────────────────────────────────────────────────────────

header "POST /api/control/poll"
curl -s -X POST "$BASE_URL/api/control/poll" \
  -H "$CT" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "chat_id": 0,
    "question": "Is the Control API working?",
    "options": ["Yes!", "No", "Need more features"],
    "is_anonymous": false,
    "allows_multiple_answers": false
  }' | python3 -m json.tool 2>/dev/null || echo "(no json)"

# ─── Send Chat Action ─────────────────────────────────────────────────────

header "POST /api/control/action"
curl -s -X POST "$BASE_URL/api/control/action" \
  -H "$CT" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "chat_id": 0,
    "action": "typing"
  }' | python3 -m json.tool 2>/dev/null || echo "(no json)"

# ─── Set State ────────────────────────────────────────────────────────────

header "POST /api/control/state"
curl -s -X POST "$BASE_URL/api/control/state" \
  -H "$CT" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "session_id": "test-session",
    "model_id": "godmode/DeepSeek-v4-Pro"
  }' | python3 -m json.tool 2>/dev/null || echo "(no json)"

echo
echo "✅ All test requests sent."
echo "   (chat_id=0 calls will fail — replace with real chat ID for actual delivery)"
