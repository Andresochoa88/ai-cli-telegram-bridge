# Channel Bridge Pattern

A lightweight architectural pattern for connecting any external messaging channel to a local AI CLI agent running as a background daemon.

## What it is

The channel bridge is a thin translation process that sits between an external communication channel (Telegram, Slack, Discord, email, SMS, HTTP) and a local AI CLI (`claude`, `codex`, or any other CLI that accepts a prompt and returns a response).

The bridge has no intelligence of its own. It does exactly three things:

1. Receive a message from the external channel
2. Invoke the local CLI with that message as input
3. Return the CLI output back to the channel

Everything else — reasoning, memory, context loading, tool use — is handled by the CLI agent.

## Why this works

Modern AI CLIs are designed for non-interactive invocation. Both `claude --print` and `codex exec` accept a prompt as an argument, run the full agent loop, and write the result to stdout or a file. This makes them trivially scriptable.

The missing piece is persistence: CLIs die when the terminal closes. The bridge solves this by running as a macOS LaunchAgent — a process that starts at login, restarts on crash, and runs without any terminal session attached.

Long polling (used by grammy and most Telegram libraries) means no public IP or webhook server is needed. The process reaches out to Telegram's servers; Telegram never reaches in.

## Core components

```
[external channel]
        ↓  (long poll / webhook / IMAP / etc.)
[bridge process]  ←── runs as LaunchAgent
        ↓  (execFile / spawn)
[AI CLI]  ←── claude --print, codex exec, etc.
        ↓  (stdout / output file)
[bridge process]
        ↓  (reply API call)
[external channel]
```

### Bridge process

A small TypeScript/Bun process (or any runtime). Its job is protocol translation only. It should:

- authenticate with the external channel
- receive messages in whatever format the channel sends
- normalize them to a plain string prompt
- invoke the CLI
- send the response back

The bridge process should be stateless beyond what the CLI session handles. Do not build business logic into it.

### LaunchAgent

The macOS launchd plist that keeps the bridge alive. Key properties:

- `RunAtLoad: true` — starts when the user logs in
- `KeepAlive: true` — restarts automatically on crash
- `EnvironmentVariables` — injects token, CLI path, and context directory at daemon level, so the process has them without any shell profile loading

The `WorkingDirectory` in the plist sets the process's cwd, which the CLI may use to locate memory files.

### Context directory (`cwd`)

The directory passed to the CLI as its working directory (or `-C` flag for Codex). This is where the CLI loads its memory, configuration, and agent identity from.

Getting this right is the most important configuration decision. A wrong `cwd` produces a context-free response. The correct `cwd` gives the agent full memory and persona.

## Session handling

Different CLIs handle session state differently:

**Claude Code (`claude --print`):** Supports explicit session IDs via `--session-id` and `--resume`. The bridge can persist a session ID to a file and resume it on subsequent messages, giving the agent conversational memory across Telegram messages.

**Codex (`codex exec`):** Uses `--ephemeral` mode, which treats each invocation as independent. Context comes from the working directory, not from session state.

When extending to a new CLI, check whether it supports session continuity and wire it accordingly.

## Extending to other channels

The pattern is channel-agnostic. To add a new channel:

### Slack

Replace grammy with the Slack Bolt SDK (`@slack/bolt`). Subscribe to `message` events in your app. The rest of the bridge logic is identical.

```typescript
app.message(async ({ message, say }) => {
  const response = await invokeCLI(message.text);
  await say(response);
});
```

Slack requires either a public webhook URL (use ngrok in dev, a real server in prod) or socket mode (no public IP needed, similar to long polling).

### Discord

Use `discord.js`. Listen to `messageCreate` events. Same pattern.

```typescript
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const response = await invokeCLI(message.content);
  await message.reply(response);
});
```

### Email (IMAP/SMTP)

Poll an IMAP mailbox for new messages. Parse the body as the prompt. Reply via SMTP.

Libraries: `imapflow` for IMAP, `nodemailer` for SMTP.

This is useful for async workflows where response latency of minutes is acceptable.

### SMS (Twilio)

Twilio sends incoming SMS as an HTTP POST to a webhook URL. Run a small HTTP server (Express or Bun's built-in server) to receive it.

```typescript
app.post("/sms", async (req, res) => {
  const prompt = req.body.Body;
  const response = await invokeCLI(prompt);
  res.send(`<Response><Message>${response}</Message></Response>`);
});
```

### HTTP webhook (generic)

For any HTTP-based trigger (n8n, Make, Zapier, custom dashboards), expose a minimal POST endpoint. This is the most general extension point.

```typescript
server.post("/invoke", async (req, res) => {
  const { prompt } = await req.json();
  const response = await invokeCLI(prompt);
  res.json({ response });
});
```

## The `invokeCLI` abstraction

Regardless of channel, the CLI invocation logic is the same. Extract it as a shared function:

```typescript
async function invokeCLI(prompt: string): Promise<string> {
  // For Claude Code:
  const { stdout } = await execFileAsync(CLAUDE_BIN, ["--print", prompt], {
    timeout: 120_000,
    maxBuffer: 1024 * 1024 * 4,
  });
  return stdout.trim() || "(no response)";

  // For Codex:
  const tmpFile = `/tmp/response-${Date.now()}.txt`;
  await execFileAsync(CODEX_BIN, ["exec", prompt, "-C", CODEX_CWD, "-o", tmpFile]);
  const result = readFileSync(tmpFile, "utf8").trim();
  unlinkSync(tmpFile);
  return result || "(no response)";
}
```

Wrap this in a channel-specific handler and you have a new bridge in under 50 lines of code.

## Design constraints

**Keep the bridge dumb.** Resist the temptation to add routing logic, intent detection, or command parsing inside the bridge. If you need that, build it into the CLI agent's memory and instructions, not the bridge.

**One bridge per channel per CLI.** Running a single bridge process that serves multiple channels or multiple CLIs creates shared state and makes debugging harder. Launch separate LaunchAgents per combination.

**Tokens never in source.** The bot token and any API keys are injected via `EnvironmentVariables` in the plist, generated at install time by the installer. They never appear in the source files.

**Timeouts matter.** AI CLI invocations can take 30-120 seconds. Set generous timeouts in `execFileAsync` and make sure the channel's typing indicator or "processing" state covers that window.
