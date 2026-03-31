#!/usr/bin/env bash
set -euo pipefail

# ── paths ──────────────────────────────────────────────────────────────────────

BOT_DIR="$HOME/.claude/channels/telegram/bot"
LOG_DIR="$HOME/.claude/channels/telegram"
ENV_FILE="$HOME/.claude/channels/telegram/.env"
PLIST_DEST="$HOME/Library/LaunchAgents/com.claude-telegram.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_TEMPLATE="$SCRIPT_DIR/com.claude-telegram.plist.template"

# ── dependency checks ──────────────────────────────────────────────────────────

BUN_BIN=""
for candidate in "$HOME/.bun/bin/bun" "/usr/local/bin/bun" "/opt/homebrew/bin/bun"; do
  if [[ -x "$candidate" ]]; then
    BUN_BIN="$candidate"
    break
  fi
done

if [[ -z "$BUN_BIN" ]]; then
  echo "Error: bun not found. Install it from https://bun.sh and re-run this script."
  exit 1
fi

CLAUDE_BIN=""
for candidate in "$HOME/.local/bin/claude" "/usr/local/bin/claude" "/opt/homebrew/bin/claude"; do
  if [[ -x "$candidate" ]]; then
    CLAUDE_BIN="$candidate"
    break
  fi
done

if [[ -z "$CLAUDE_BIN" ]]; then
  echo "Error: claude CLI not found. Install Claude Code and ensure it is authenticated, then re-run this script."
  exit 1
fi

# ── token input ────────────────────────────────────────────────────────────────

if [[ -f "$ENV_FILE" ]]; then
  EXISTING_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- || true)
fi

if [[ -n "${EXISTING_TOKEN:-}" ]]; then
  echo "Existing token found in $ENV_FILE."
  read -r -p "Enter a new TELEGRAM_BOT_TOKEN (leave blank to keep existing): " INPUT_TOKEN
  TELEGRAM_BOT_TOKEN="${INPUT_TOKEN:-$EXISTING_TOKEN}"
else
  read -r -s -p "Enter TELEGRAM_BOT_TOKEN: " TELEGRAM_BOT_TOKEN
  echo
fi

if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
  echo "Error: TELEGRAM_BOT_TOKEN cannot be empty."
  exit 1
fi

# ── claude cwd input ───────────────────────────────────────────────────────────
# CLAUDE_CWD is the directory Claude Code will use as its working directory.
# This determines which CLAUDE.md and memory files are loaded — it is the
# single most important configuration value. Point it at the directory where
# your agent's memory and CLAUDE.md live.

read -r -p "Enter CLAUDE_CWD — the directory Claude Code loads context from (default: $HOME): " INPUT_CWD
CLAUDE_CWD="${INPUT_CWD:-$HOME}"

# ── directory setup ────────────────────────────────────────────────────────────

mkdir -p "$BOT_DIR"
mkdir -p "$LOG_DIR"

# ── copy bot files ─────────────────────────────────────────────────────────────

cp "$SCRIPT_DIR/server.ts"    "$BOT_DIR/server.ts"
cp "$SCRIPT_DIR/package.json" "$BOT_DIR/package.json"

# ── save token ─────────────────────────────────────────────────────────────────

printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TELEGRAM_BOT_TOKEN" > "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ── install dependencies ───────────────────────────────────────────────────────

echo "Running bun install..."
"$BUN_BIN" install --cwd "$BOT_DIR"

# ── generate plist ─────────────────────────────────────────────────────────────

BUN_DIR="$(dirname "$BUN_BIN")"
CLAUDE_DIR="$(dirname "$CLAUDE_BIN")"

sed \
  -e "s|__BUN_PATH__|$BUN_BIN|g" \
  -e "s|__BOT_PATH__|$BOT_DIR/server.ts|g" \
  -e "s|__TELEGRAM_BOT_TOKEN__|$TELEGRAM_BOT_TOKEN|g" \
  -e "s|__HOME__|$HOME|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  -e "s|__BUN_DIR__|$BUN_DIR|g" \
  -e "s|__CLAUDE_DIR__|$CLAUDE_DIR|g" \
  -e "s|__CLAUDE_BIN__|$CLAUDE_BIN|g" \
  -e "s|__CLAUDE_CWD__|$CLAUDE_CWD|g" \
  "$PLIST_TEMPLATE" > "$PLIST_DEST"

# ── load service ───────────────────────────────────────────────────────────────
# We use bootout + bootstrap (never kickstart) because:
# - bootout gracefully stops an existing instance before reloading
# - bootstrap registers the plist into the launchd session domain correctly
# - kickstart bypasses the session domain and can cause duplicate processes or
#   stale state when the service was previously loaded via bootstrap

launchctl bootout "gui/$(id -u)/com.claude-telegram" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"

echo "Waiting for service to start..."
sleep 3

# ── verify ─────────────────────────────────────────────────────────────────────

if launchctl list | grep -q "com.claude-telegram"; then
  echo ""
  echo "Claude Code Telegram bot is running."
  echo "Context dir: $CLAUDE_CWD"
  echo "Logs: $LOG_DIR/server.log"
  echo "      $LOG_DIR/server.error.log"
else
  echo ""
  echo "Warning: service may not have started. Check logs at:"
  echo "  $LOG_DIR/server.error.log"
  exit 1
fi
