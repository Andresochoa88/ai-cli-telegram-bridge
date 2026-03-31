import { Bot } from "grammy";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const SESSION_FILE = path.join(process.env.HOME || "", ".claude/channels/telegram/session-id");

const bot = new Bot(TELEGRAM_BOT_TOKEN);

bot.on("message:text", async (ctx) => {
  const userText = ctx.message.text;
  const chatId = ctx.chat.id;

  console.log(`[${new Date().toISOString()}] message from ${chatId}: ${userText}`);

  try {
    await bot.api.sendChatAction(chatId, "typing");

    let args: string[];
    if (existsSync(SESSION_FILE)) {
      const sessionId = readFileSync(SESSION_FILE, "utf8").trim();
      args = ["--print", "--resume", sessionId, userText];
    } else {
      const sessionId = randomUUID();
      args = ["--print", "--session-id", sessionId, "--name", "telegram-bot", userText];
      writeFileSync(SESSION_FILE, sessionId, "utf8");
    }

    const { stdout, stderr } = await execFileAsync(CLAUDE_BIN, args, {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 4,
      stdio: ["ignore", "pipe", "pipe"],
    } as any);

    if (stderr) {
      console.warn(`[${new Date().toISOString()}] claude stderr: ${stderr}`);
    }

    const reply = stdout.trim() || "(no response)";
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
