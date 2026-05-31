import os from "node:os";
import path from "node:path";
import { getRuntimeMode, type RuntimeMode } from "./mode.js";

export interface RuntimePaths {
  mode: RuntimeMode;
  appHome: string;
  adminHome: string | null;
  envFilePath: string;
  adminEnvFilePath: string | null;
  settingsFilePath: string;
  dbFilePath: string;
  logsDirPath: string;
  runDirPath: string;
}

const APP_DIR_NAME = "opencode-telegram-bot";
const DEFAULT_WORKSPACES_ROOT = "/home/me/Workspaces";

function getInstalledAppHome(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, APP_DIR_NAME);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_DIR_NAME);
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, APP_DIR_NAME);
}

function resolveAppHome(mode: RuntimeMode): string {
  const homeOverride = process.env.OPENCODE_TELEGRAM_HOME;
  if (homeOverride && homeOverride.trim().length > 0) {
    return path.resolve(homeOverride);
  }

  if (mode === "sources") {
    return process.cwd();
  }

  return getInstalledAppHome();
}

export function getWorkspacesRoot(): string {
  const workspacesRootOverride = process.env.WORKSPACES_ROOT;
  if (workspacesRootOverride && workspacesRootOverride.trim().length > 0) {
    return path.resolve(workspacesRootOverride);
  }

  return DEFAULT_WORKSPACES_ROOT;
}

export function getRuntimePaths(): RuntimePaths {
  const mode = getRuntimeMode();
  const appHome = resolveAppHome(mode);

  const adminHomeOverride = process.env.OPENCODE_TELEGRAM_ADMIN_HOME;
  const adminHome = adminHomeOverride && adminHomeOverride.trim().length > 0
    ? path.resolve(adminHomeOverride)
    : null;

  return {
    mode,
    appHome,
    adminHome,
    envFilePath: path.join(appHome, ".env"),
    adminEnvFilePath: adminHome ? path.join(adminHome, ".env") : null,
    settingsFilePath: path.join(appHome, "settings.json"),
    dbFilePath: path.join(appHome, "settings.db"),
    logsDirPath: path.join(appHome, "logs"),
    runDirPath: path.join(appHome, "run"),
  };
}
