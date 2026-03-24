import path from "node:path";
import { opencodeClient } from "../opencode/client.js";
import { type ProjectInfo } from "../settings/manager.js";
import { logger } from "../utils/logger.js";

const USER_SESSIONS_DIR = "sessions";

export function getUserSessionDirectory(tgId: number): string {
  return path.join(USER_SESSIONS_DIR, String(tgId));
}

export async function getOrCreateUserProject(tgId: number): Promise<ProjectInfo> {
  const userDir = getUserSessionDirectory(tgId);

  logger.debug(`[UserProject] Getting/creating project for tgId=${tgId}, directory=${userDir}`);

  const { data: projects, error: listError } = await opencodeClient.project.list();

  if (listError || !projects) {
    logger.error("[UserProject] Failed to list projects:", listError);
    throw listError || new Error("No data received from server");
  }

  const existingProject = projects.find((p) => p.worktree === userDir);

  if (existingProject) {
    logger.debug(
      `[UserProject] Found existing project: ${existingProject.id}, worktree=${existingProject.worktree}`,
    );
    return {
      id: existingProject.id,
      worktree: existingProject.worktree,
      name: existingProject.name || existingProject.worktree,
    };
  }

  logger.info(`[UserProject] Creating new project for tgId=${tgId} in directory=${userDir}`);

  const { data: session, error: createError } = await opencodeClient.session.create({
    directory: userDir,
  });

  if (createError || !session) {
    logger.error("[UserProject] Failed to create session:", createError);
    throw createError || new Error("No data received from server");
  }

  const { data: projectCurrent, error: currentError } = await opencodeClient.project.current();

  if (currentError || !projectCurrent) {
    logger.error("[UserProject] Failed to get current project:", currentError);
    throw currentError || new Error("No data received from server");
  }

  const projectInfo: ProjectInfo = {
    id: projectCurrent.id,
    worktree: projectCurrent.worktree,
    name: projectCurrent.name || projectCurrent.worktree,
  };

  logger.info(
    `[UserProject] Created new project: id=${projectInfo.id}, worktree=${projectInfo.worktree} for tgId=${tgId}`,
  );

  return projectInfo;
}

export async function ensureUserProjectForCommand(tgId: number): Promise<ProjectInfo> {
  return getOrCreateUserProject(tgId);
}
