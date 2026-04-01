import { Bot } from "grammy";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";

const execFileAsync = promisify(execFile);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_CWD = process.env.CLAUDE_CWD || process.env.HOME;
const SESSIONS_FILE = `${process.env.HOME}/.claude/channels/telegram/sessions.json`;

// Load sessions from disk (survives daemon restarts)
const sessions: Record<number, string> = (() => {
  try {
    if (existsSync(SESSIONS_FILE)) {
      return JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
    }
  } catch {}
  return {};
})();

function saveSession(chatId: number, sessionId: string) {
  sessions[chatId] = sessionId;
  try {
    writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf8");
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] could not save session:`, err);
  }
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

bot.on("message:text", async (ctx) => {
  const userText = ctx.message.text;
  const chatId = ctx.chat.id;

  console.log(`[${new Date().toISOString()}] message from ${chatId}: ${userText}`);

  try {
    await bot.api.sendChatAction(chatId, "typing");

    console.log(`[${new Date().toISOString()}] cwd=${CLAUDE_CWD}`);

    let args: string[];
    const existingSession = sessions[chatId];
    if (existingSession) {
      console.log(`[${new Date().toISOString()}] resuming session ${existingSession}`);
      args = ["--print", "--resume", existingSession, userText];
    } else {
      const sessionId = randomUUID();
      saveSession(chatId, sessionId);
      console.log(`[${new Date().toISOString()}] new session ${sessionId}`);
      args = ["--print", "--session-id", sessionId, userText];
    }

    const { stdout, stderr } = await execFileAsync(CLAUDE_BIN, args, {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 4,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: CLAUDE_CWD,
    } as any);

    if (stderr) {
      console.warn(`[${new Date().toISOString()}] stderr: ${stderr.trim()}`);
    }

    const reply = stdout.trim() || "(no response)";
    console.log(`[${new Date().toISOString()}] response: ${reply.slice(0, 200)}`);
    await ctx.reply(reply);
    console.log(`[${new Date().toISOString()}] replied to ${chatId}`);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] error:`, err);
    const detail = err?.stderr?.trim() || err?.message || "unknown error";
    await ctx.reply(`Claude Code encountered an error: ${detail}`);
  }
});

bot.catch((err) => {
  console.error(`[${new Date().toISOString()}] bot error:`, err);
});

const shutdown = async () => {
  console.log("Claude Code Telegram bot: shutting down...");
  await bot.stop();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

bot.start({
  onStart: (info) => {
    console.log(`Claude Code Telegram bot: polling as @${info.username}`);
  },
}).catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
