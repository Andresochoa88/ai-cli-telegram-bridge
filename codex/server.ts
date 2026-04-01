import { Bot } from "grammy";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CODEX_CWD = process.env.CODEX_CWD || `${process.env.HOME}/.codex`;
const SESSIONS_FILE = `${CODEX_CWD}/channels/telegram/sessions.json`;

// Load sessions from disk (survives daemon restarts)
const sessions: Record<number, string> = (() => {
  try {
    if (existsSync(SESSIONS_FILE)) {
      return JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
    }
  } catch {}
  return {};
})();

function saveSession(chatId: number, threadId: string) {
  sessions[chatId] = threadId;
  try {
    writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf8");
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] could not save session:`, err);
  }
}

function parseJsonl(stdout: string): { threadId?: string; reply?: string } {
  let threadId: string | undefined;
  let reply: string | undefined;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "thread.started" && event.thread_id) {
        threadId = event.thread_id;
      }
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        event.item?.text
      ) {
        reply = event.item.text;
      }
    } catch {}
  }
  return { threadId, reply };
}

function runCodex(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(CODEX_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"], // stdin=closed, stdout/stderr=buffered
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`codex timed out after 120s. stderr: ${stderr.trim()}`));
    }, 120_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`codex exited ${code}. stderr: ${stderr.trim()}`));
      } else {
        resolve({ stdout, stderr });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

bot.on("message:text", async (ctx) => {
  const userText = ctx.message.text;
  const chatId = ctx.chat.id;

  console.log(`[${new Date().toISOString()}] message from ${chatId}: ${userText}`);

  try {
    await bot.api.sendChatAction(chatId, "typing");

    const existingSession = sessions[chatId];
    let args: string[];

    if (existingSession) {
      console.log(`[${new Date().toISOString()}] resuming session ${existingSession}`);
      args = [
        "exec", "resume", existingSession, userText,
        "--skip-git-repo-check", "--full-auto", "--json",
      ];
    } else {
      console.log(`[${new Date().toISOString()}] new session, cwd=${CODEX_CWD}`);
      args = [
        "exec", userText,
        "-C", CODEX_CWD,
        "--skip-git-repo-check", "--full-auto", "--json",
      ];
    }

    const { stdout, stderr } = await runCodex(args);

    if (stderr) {
      console.warn(`[${new Date().toISOString()}] stderr: ${stderr.trim()}`);
    }

    const { threadId, reply } = parseJsonl(stdout);

    if (threadId && !existingSession) {
      saveSession(chatId, threadId);
      console.log(`[${new Date().toISOString()}] saved new session ${threadId}`);
    }

    const response = reply || "(no response)";
    console.log(`[${new Date().toISOString()}] response: ${response.slice(0, 200)}`);
    await ctx.reply(response);
    console.log(`[${new Date().toISOString()}] replied to ${chatId}`);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] error:`, err);
    const detail = err?.message || "unknown error";
    await ctx.reply(`Codex encountered an error: ${detail}`);
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
