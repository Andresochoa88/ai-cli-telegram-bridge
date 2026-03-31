#!/usr/bin/env bash
set -euo pipefail

PLIST_DEST="$HOME/Library/LaunchAgents/com.claude-telegram.plist"
BOT_DIR="$HOME/.claude/channels/telegram/bot"
ACCESS_FILE="$HOME/.claude/channels/telegram/access.json"

# ── stop and unload service ────────────────────────────────────────────────────

launchctl bootout "gui/$(id -u)/com.claude-telegram" 2>/dev/null || true

# ── remove plist ───────────────────────────────────────────────────────────────

if [[ -f "$PLIST_DEST" ]]; then
  rm "$PLIST_DEST"
fi

# ── remove bot directory ───────────────────────────────────────────────────────

if [[ -d "$BOT_DIR" ]]; then
  rm -rf "$BOT_DIR"
fi

# ── remove access.json if present ─────────────────────────────────────────────

if [[ -f "$ACCESS_FILE" ]]; then
  rm "$ACCESS_FILE"
fi

echo "Claude Code Telegram bot uninstalled. Token and logs preserved at $HOME/.claude/channels/telegram/"
