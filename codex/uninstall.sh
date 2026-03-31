#!/usr/bin/env bash
set -euo pipefail

PLIST_DEST="$HOME/Library/LaunchAgents/com.codex-telegram.plist"
BOT_DIR="$HOME/.codex/channels/telegram/bot"
ACCESS_FILE="$HOME/.codex/channels/telegram/access.json"

# ── stop and unload service ────────────────────────────────────────────────────

launchctl bootout "gui/$(id -u)/com.codex-telegram" 2>/dev/null || true

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

echo "Codex Telegram bot uninstalled. Token and logs preserved at $HOME/.codex/channels/telegram/"
