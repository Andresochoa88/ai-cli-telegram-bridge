import { Bot } from "grammy";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, unlinkSync } from "fs";

const execFileAsync = promisify(execFile);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CODEX_CWD = process.env.CODEX_CWD || `${process.env.HOME}/.codex`;

const bot = new Bot(TELEGRAM_BOT_TOKEN);

bot.on("message:text", async (ctx) => {
  const userText = ctx.message.text;
  const chatId = ctx.chat.id;

  console.log(`[${new Date().toISOString()}] message from ${chatId}: ${userText}`);

  const tmpFile = `/tmp/codex-response-${Date.now()}.txt`;

  try {
    await bot.api.sendChatAction(chatId, "typing");

    console.log(`[${new Date().toISOString()}] cwd=${CODEX_CWD}`);

    const { stderr } = await execFileAsync(
      CODEX_BIN,
      ["exec", userText, "-C", CODEX_CWD, "-o", tmpFile, "--ephemeral"],
      {
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 4,
      } as any
    );

    if (stderr) {
      console.warn(`[${new Date().toISOString()}] stderr: ${stderr.trim()}`);
    }

    const reply = readFileSync(tmpFile, "utf8").trim() || "(no response)";
    console.log(`[${new Date().toISOString()}] response: ${reply.slice(0, 200)}`);
    await ctx.reply(reply);
    console.log(`[${new Date().toISOString()}] replied to ${chatId}`);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] error:`, err);
    const detail = err?.stderr?.trim() || err?.message || "unknown error";
    await ctx.reply(`Codex encountered an error: ${detail}`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
});

bot.catch((err) => {
  console.error(`[${new Date().toISOString()}] bot error:`, err);
});

const shutdown = async () => {
  console.log("Codex Telegram bot: shutting down...");
  await bot.stop();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

bot.start({
  onStart: (info) => {
    console.log(`Codex Telegram bot: polling as @${info.username}`);
  },
}).catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
