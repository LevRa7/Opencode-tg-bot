import fs from "node:fs";
import { CommandContext, Context, InlineKeyboard } from "grammy";
import { sshManager, type SshDetails, type SshAuth, type SavedSshConnection } from "../../utils/ssh-manager.js";
import { interactionManager } from "../../interaction/manager.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { logger } from "../../utils/logger.js";
import { stopEventListening } from "../../opencode/events.js";
import { t } from "../../i18n/index.js";
import { clearSessionDirectoryCacheForScope } from "../../session/cache-manager.js";
import { SubdomainManager } from "../../server/subdomain-manager.js";
import { getSubdomainsRepository } from "../../settings/manager.js";
import { config } from "../../config.js";

const PREFIX = "ssh:";
const ACTION_CONNECT = "ssh:conn:";
const ACTION_DELETE = "ssh:del:";
const ACTION_DISCONNECT = "ssh:disc";
const ACTION_NEW = "ssh:new";
const ACTION_CANCEL = "ssh:cancel";
const ACTION_LIST = "ssh:list";
const METHOD_PASSWORD = "ssh:pass";
const METHOD_KEY = "ssh:key";
const TARGET_DOCKER = "ssh:docker";
const TARGET_HOST = "ssh:host";

export function parseConnectionString(connStr: string): SshDetails | null {
  const trimmed = connStr.trim();
  const match = trimmed.match(/^([^@\s]+)@([^:\s]+)(?::(\d+))?$/);
  if (!match) return null;
  return {
    username: match[1],
    host: match[2],
    port: match[3] ? parseInt(match[3], 10) : 22,
  };
}

function connLabel(c: SavedSshConnection): string {
  const target = c.deployTarget === "docker" ? "🐳" : "💻";
  return `${target} ${c.details.username}@${c.details.host}:${c.details.port}`;
}

async function renderConnectionsMenu(
  ctx: Context,
  userId: number,
  edit: boolean,
): Promise<void> {
  const connections = await sshManager.getSavedConnections(userId);

  if (connections.length === 0) {
    await startNewFlow(ctx);
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const c of connections) {
    keyboard.text(connLabel(c), ACTION_CONNECT + c.id).text("✕", ACTION_DELETE + c.id).row();
  }
  keyboard.text("➕ " + t("ssh.button.new_connection"), ACTION_NEW).row();
  keyboard.text("↩ " + t("ssh.button.cancel"), ACTION_CANCEL);

  const text = "📡 " + t("ssh.saved_connections_title");

  if (edit) {
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

async function renderActiveMenu(ctx: Context, userId: number): Promise<void> {
  const conn = sshManager.getActiveConnection(userId);
  const d = conn?.details;
  if (!d) return;

  const target = conn?.deployTarget === "docker" ? "🐳 Docker" : "💻 Host";
  const text = t("ssh.active_status", {
    username: d.username,
    host: d.host,
    port: String(d.port ?? 22),
  }) + "\n" + target;

  const keyboard = new InlineKeyboard()
    .text("🔌 " + t("ssh.button.disconnect"), ACTION_DISCONNECT)
    .row()
    .text("📋 " + t("ssh.saved_connections_title"), ACTION_LIST)
    .row()
    .text("↩ " + t("ssh.button.cancel"), ACTION_CANCEL);

  await ctx.reply(text, { reply_markup: keyboard });
}

async function startNewFlow(ctx: Context): Promise<void> {
  const msg = await ctx.reply(t("ssh.prompt.conn_str"));
  interactionManager.start({
    kind: "custom",
    expectedInput: "text",
    metadata: {
      flow: "ssh",
      stage: "conn_str",
      messageId: msg.message_id,
    },
  });
}

async function doConnect(
  ctx: Context,
  userId: number,
  details: SshDetails,
  auth: SshAuth,
  deployTarget: "docker" | "host",
): Promise<void> {
  await ctx.editMessageText("⏳ " + t("ssh.connecting_saved") + "...").catch(() => {});

  let savedConnectionId: string | undefined;

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("SSH bootstrap timed out after 3 minutes")), 180_000),
    );
    await Promise.race([
      (async () => {
        await sshManager.connect(userId, details, auth, deployTarget);
        await sshManager.bootstrapRemoteServer(userId);
        savedConnectionId = await sshManager.saveConnection(userId, details, auth, deployTarget);
      })(),
      timeout,
    ]);
    await ctx.editMessageText(t("ssh.success")).catch(() => {});

    // Clear cached session directories from the previous connection to prevent
    // mixing with projects from the new SSH server.
    await clearSessionDirectoryCacheForScope();

    if (savedConnectionId) {
      const subdomainManager = new SubdomainManager(() => getSubdomainsRepository());
      const subdomain = subdomainManager.ensureSshSubdomain(
        userId,
        ctx.from?.username,
        details.host.split(":")[0].replace(/\./g, "-"),
        deployTarget === "docker" ? "ssh-docker" : "ssh-host",
        savedConnectionId,
      );

      const fullDomain = `${subdomain.subdomain}.smart-server.online`;
      await ctx.reply(
        t("ssh.web_panel_info", { domain: fullDomain, username: subdomain.username, password: subdomain.password }),
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    await sshManager.disconnect(userId).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Ssh] Setup error: ${msg}`);
    await ctx.editMessageText("❌ " + t("ssh.error", { error: msg })).catch(() => {});
  }
}

// ── Command entry ────────────────────────────────────────────────

export async function sshCommand(ctx: CommandContext<Context>): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (sshManager.isSshActive(userId)) {
    await renderActiveMenu(ctx, userId);
    return;
  }
  await renderConnectionsMenu(ctx, userId, false);
}

// ── Callback handler ─────────────────────────────────────────────

export async function handleSshCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(PREFIX)) return false;

  const userId = ctx.from?.id;
  if (!userId) return false;

  logger.debug(`[Ssh] callback: ${data}`);

  // ── Stateless actions ──

  if (data === ACTION_DISCONNECT) {
    await sshManager.disconnect(userId);
    // Stop only the event listener for the current project, not all users
    const currentProject = getCurrentProject();
    if (currentProject?.worktree) {
      stopEventListening(currentProject.worktree);
    }

    // Clear cached session directories from the SSH connection to prevent
    // them from mixing with local projects in /projects and /sessions.
    await clearSessionDirectoryCacheForScope();

    // Reset subdomain back to local kind so the MiniApp switches to host/tenant
    const isAdmin = userId === config.telegram.adminUserId;
    const subdomainManager = new SubdomainManager(() => getSubdomainsRepository());
    subdomainManager.ensureSubdomain(userId, ctx.from?.username, isAdmin ? "host" : "tenant");

    await ctx.answerCallbackQuery({ text: t("ssh.cancelled") });
    await renderConnectionsMenu(ctx, userId, true);
    return true;
  }

  if (data === ACTION_LIST) {
    await ctx.answerCallbackQuery();
    await renderConnectionsMenu(ctx, userId, true);
    return true;
  }

  if (data === ACTION_NEW) {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await startNewFlow(ctx);
    return true;
  }

  if (data === ACTION_CANCEL) {
    interactionManager.clear("ssh_cancelled");
    await ctx.answerCallbackQuery({ text: t("ssh.cancelled") });
    await ctx.deleteMessage().catch(() => {});
    return true;
  }

  if (data.startsWith(ACTION_CONNECT)) {
    const id = data.slice(ACTION_CONNECT.length);
    const saved = await sshManager.loadConnectionById(userId, id);
    if (!saved) {
      await ctx.answerCallbackQuery({ text: t("ssh.connection_not_found"), show_alert: true });
      return true;
    }
    await ctx.answerCallbackQuery();
    await doConnect(ctx, userId, saved.details, saved.auth, saved.deployTarget);
    await sshManager.setActiveConnectionId(userId, id);
    interactionManager.clear("ssh_completed");
    return true;
  }

  if (data.startsWith(ACTION_DELETE)) {
    const id = data.slice(ACTION_DELETE.length);
    await sshManager.deleteSavedConnection(userId, id);
    await ctx.answerCallbackQuery({ text: t("ssh.connection_deleted") });
    await renderConnectionsMenu(ctx, userId, true);
    return true;
  }

  // ── Interaction-flow actions (require active state) ──

  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom" || state.metadata.flow !== "ssh") {
    return false;
  }

  const stage = state.metadata.stage;

  if (stage === "auth_method") {
    if (data === METHOD_PASSWORD) {
      await ctx.answerCallbackQuery();
      const msg = (await ctx.editMessageText(t("ssh.prompt.password"), {
        reply_markup: new InlineKeyboard().text(t("ssh.button.cancel"), ACTION_CANCEL),
      })) as any;
      interactionManager.transition({
        metadata: { ...state.metadata, stage: "password", messageId: msg.message_id },
        expectedInput: "text",
      });
      return true;
    }
    if (data === METHOD_KEY) {
      await ctx.answerCallbackQuery();
      const msg = (await ctx.editMessageText(t("ssh.prompt.private_key"), {
        reply_markup: new InlineKeyboard().text(t("ssh.button.cancel"), ACTION_CANCEL),
      })) as any;
      interactionManager.transition({
        metadata: { ...state.metadata, stage: "private_key", messageId: msg.message_id },
        expectedInput: "text",
      });
      return true;
    }
  }

  if (stage === "target") {
    const target = data === TARGET_DOCKER ? "docker" : "host";
    await ctx.answerCallbackQuery();
    const details = state.metadata.details as SshDetails;
    const auth = state.metadata.auth as SshAuth;
    await doConnect(ctx, userId, details, auth, target);
    interactionManager.clear("ssh_completed");
    return true;
  }

  return false;
}

// ── Text-input handler ───────────────────────────────────────────

export async function handleSshTextArguments(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) return false;

  const userId = ctx.from?.id;
  if (!userId) return false;

  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom" || state.metadata.flow !== "ssh") return false;

  const stage = state.metadata.stage;
  const msgId = state.metadata.messageId as number;

  if (stage === "conn_str") {
    const details = parseConnectionString(text);
    if (!details) {
      await ctx.reply(t("ssh.invalid_format")).catch(() => {});
      return true;
    }
    await ctx.deleteMessage().catch(() => {});

    const kb = new InlineKeyboard()
      .text("🔑 " + t("ssh.button.password"), METHOD_PASSWORD)
      .text("🔐 " + t("ssh.button.private_key"), METHOD_KEY)
      .row()
      .text(t("ssh.button.cancel"), ACTION_CANCEL);

    await ctx.api.editMessageText(ctx.chat!.id, msgId, t("ssh.prompt.auth_method"), { reply_markup: kb }).catch(() => {});
    interactionManager.transition({
      metadata: { ...state.metadata, details, stage: "auth_method" },
      expectedInput: "callback",
    });
    return true;
  }

  if (stage === "password") {
    const auth: SshAuth = { password: text.trim() };
    await ctx.deleteMessage().catch(() => {});

    const kb = new InlineKeyboard()
      .text("🐳 " + t("ssh.button.docker"), TARGET_DOCKER)
      .text("💻 " + t("ssh.button.host"), TARGET_HOST)
      .row()
      .text(t("ssh.button.cancel"), ACTION_CANCEL);

    await ctx.api.editMessageText(ctx.chat!.id, msgId, t("ssh.prompt.target"), { reply_markup: kb }).catch(() => {});
    interactionManager.transition({
      metadata: { ...state.metadata, auth, stage: "target" },
      expectedInput: "callback",
    });
    return true;
  }

  if (stage === "private_key") {
    const auth: SshAuth = { privateKey: text.trim() };
    await ctx.deleteMessage().catch(() => {});

    const kb = new InlineKeyboard()
      .text("🐳 " + t("ssh.button.docker"), TARGET_DOCKER)
      .text("💻 " + t("ssh.button.host"), TARGET_HOST)
      .row()
      .text(t("ssh.button.cancel"), ACTION_CANCEL);

    await ctx.api.editMessageText(ctx.chat!.id, msgId, t("ssh.prompt.target"), { reply_markup: kb }).catch(() => {});
    interactionManager.transition({
      metadata: { ...state.metadata, auth, stage: "target" },
      expectedInput: "callback",
    });
    return true;
  }

  return false;
}

export function getSkillsToUpload(): string[] {
  const baseSkills = ["tg-cli", "openai-media-transcriber", "gpt-image-api"];
  try {
    const pkgSkillsDir = "docker/opencode-skills-pkg/skills";
    if (fs.existsSync(pkgSkillsDir)) {
      const categories = fs.readdirSync(pkgSkillsDir, { withFileTypes: true });
      for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        const catPath = pkgSkillsDir + "/" + cat.name;
        const entries = fs.readdirSync(catPath, { withFileTypes: true });
        for (const entry of entries) {
          let skillName: string | null = null;
          if (entry.isDirectory()) {
            const skillMd = catPath + "/" + entry.name + "/opencode.md";
            if (fs.existsSync(skillMd)) {
              skillName = entry.name;
            }
          } else if (entry.isFile() && entry.name.endsWith(".md")) {
            skillName = entry.name.slice(0, -3);
          }
          if (skillName && !baseSkills.includes(skillName)) {
            baseSkills.push(skillName);
          }
        }
      }
    }
  } catch {
    // Fallback
  }
  return baseSkills;
}
