# ai-cli-telegram-bridge

> Connect Telegram to your local AI CLI — Claude Code or Codex — as a persistent daemon.

A minimal bridge that lets you message your AI agent from Telegram. No cloud, no webhook server, no public IP. The bot runs as a macOS LaunchAgent alongside your CLI agent.

## The pattern

```
Telegram message
    ↓
grammy (long polling — no webhook needed)
    ↓
AI CLI invocation (claude --print OR codex exec)
    ↓
response → Telegram
```

Your Telegram message becomes a CLI prompt. The response comes back to the chat. The bot has no logic of its own — it is a pure translation layer between Telegram's protocol and your local AI.

## Why not the official plugin?

Both Claude Code and Codex have plugin/integration systems. Neither works as a persistent background daemon because they require an active terminal session. The moment you close the terminal, the bot dies.

This bridge runs as a macOS LaunchAgent — it starts at login, restarts on crash, and runs forever in the background without an open terminal.

## Implementations

| CLI | Folder | Key command |
|---|---|---|
| Claude Code (`claude`) | [`claude-code/`](./claude-code/) | `claude --print "<message>"` |
| Codex (`codex`) | [`codex/`](./codex/) | `codex exec "<message>" -C <dir> -o <file>` |

Choose the one that matches your CLI. Both follow the same architecture.

## How context works

The `cwd` passed to the CLI determines what memory and configuration your agent loads. If you point it at the right directory, your agent responds with full context. If not, it responds as a generic assistant.

- Claude Code: set `CLAUDE_CWD` to the project directory where your `CLAUDE.md` and memory live
- Codex: set `CODEX_CWD` to the directory Codex uses as its context root

**This is the single most important configuration value.** Getting it wrong is the most common cause of context-less responses.

## Setup

### 1. Create a Telegram bot

Talk to [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.

### 2. Run the installer for your CLI

**Claude Code:**
```bash
cd claude-code
bash install.sh
```

**Codex:**
```bash
cd codex
bash install.sh
```

The installer:
- Finds the CLI binary
- Asks for your bot token and context directory
- Copies bot files to `~/.claude/channels/telegram/` or `~/.codex/channels/telegram/`
- Registers and starts the LaunchAgent

### 3. Test it

Send a message to your bot. You should get a response within a few seconds.

## Troubleshooting

**Agent responds without context:** Check the log for `cwd=`. If it's wrong, re-run `install.sh` with the correct directory.

**Bot not responding:** `launchctl list | grep com.claude-telegram` (or `com.codex-telegram`). Check the error log.

**Service doesn't survive reboot:** Verify the plist is in `~/Library/LaunchAgents/` and was loaded with `launchctl bootstrap gui/<uid> <plist>`.

**After changing the plist:** Never use `launchctl kickstart` to reload — it does not re-read environment variables. Use:
```bash
launchctl bootout gui/$(id -u)/com.claude-telegram
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.claude-telegram.plist
```

## Logs

```
# Claude Code
~/.claude/channels/telegram/server.log
~/.claude/channels/telegram/server.error.log

# Codex
~/.codex/channels/telegram/codex.log
~/.codex/channels/telegram/codex.error.log
```

## Requirements

- macOS (uses launchd)
- [Bun](https://bun.sh)
- Claude Code CLI (`claude`) or Codex CLI (`codex`), installed and authenticated
- Telegram bot token

## Uninstall

```bash
bash uninstall.sh   # from the implementation folder
```

---

For the architectural explanation of this pattern and how to extend it to other channels, see [`docs/channel-bridge-pattern.md`](./docs/channel-bridge-pattern.md).
