import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { opencodeClient } from "../opencode/client.js";
import { ProjectInfo } from "../settings/manager.js";
import { getCachedSessionProjects } from "../session/cache-manager.js";
import { logger } from "../utils/logger.js";

const ROOT_PROJECT: ProjectInfo = {
  id: "global",
  worktree: "/",
  name: "/",
};

interface InternalProject extends ProjectInfo {
  lastUpdated: number;
}

async function isLinkedGitWorktree(worktree: string): Promise<boolean> {
  if (worktree === "/") {
    return false;
  }

  const gitPath = path.join(worktree, ".git");

  try {
    const gitStat = await stat(gitPath);

    if (!gitStat.isFile()) {
      return false;
    }

    const gitPointer = (await readFile(gitPath, "utf-8")).trim();
    const match = gitPointer.match(/^gitdir:\s*(.+)$/i);
    if (!match) {
      return false;
    }

    const gitDir = path.resolve(worktree, match[1].trim()).replace(/\\/g, "/").toLowerCase();
    return gitDir.includes("/.git/worktrees/");
  } catch {
    return false;
  }
}

function worktreeKey(worktree: string): string {
  if (process.platform === "win32") {
    return worktree.toLowerCase();
  }

  return worktree;
}

interface GetProjectsOptions {
  includeLinkedWorktrees?: boolean;
}

export async function getProjects(options: GetProjectsOptions = {}): Promise<ProjectInfo[]> {
  const { data: projects, error } = await opencodeClient.project.list();

  if (error || !projects) {
    throw error || new Error("No data received from server");
  }

  const apiProjects: InternalProject[] = projects.map((project) => ({
    id: project.id,
    worktree: project.worktree,
    name: project.name || project.worktree,
    lastUpdated: project.time?.updated ?? 0,
  }));

  const cachedProjects = await getCachedSessionProjects();
  const mergedByWorktree = new Map<string, InternalProject>();

  for (const apiProject of apiProjects) {
    mergedByWorktree.set(worktreeKey(apiProject.worktree), apiProject);
  }

  for (const cachedProject of cachedProjects) {
    const key = worktreeKey(cachedProject.worktree);
    const existing = mergedByWorktree.get(key);

    if (existing) {
      if ((cachedProject.lastUpdated ?? 0) > existing.lastUpdated) {
        existing.lastUpdated = cachedProject.lastUpdated;
      }
      continue;
    }

    mergedByWorktree.set(key, {
      id: cachedProject.id,
      worktree: cachedProject.worktree,
      name: cachedProject.name,
      lastUpdated: cachedProject.lastUpdated ?? 0,
    });
  }

  const projectList = Array.from(mergedByWorktree.values()).sort(
    (left, right) => right.lastUpdated - left.lastUpdated,
  );

  let visibleProjects: InternalProject[];
  let hiddenLinkedWorktrees: number;

  if (options.includeLinkedWorktrees) {
    visibleProjects = projectList;
    hiddenLinkedWorktrees = 0;
  } else {
    const linkedWorktreeFlags = await Promise.all(
      projectList.map((project) => isLinkedGitWorktree(project.worktree)),
    );
    visibleProjects = projectList.filter((_, index) => !linkedWorktreeFlags[index]);
    hiddenLinkedWorktrees = projectList.length - visibleProjects.length;
  }

  logger.debug(
    `[ProjectManager] Projects resolved: api=${projects.length}, cached=${cachedProjects.length}, hiddenLinkedWorktrees=${hiddenLinkedWorktrees}, total=${visibleProjects.length}`,
  );

  return visibleProjects.map(({ id, worktree, name }) => ({ id, worktree, name }));
}

export async function getProjectById(id: string): Promise<ProjectInfo> {
  const projects = await getProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) {
    throw new Error(`Project with id ${id} not found`);
  }
  return project;
}

export async function getProjectByWorktree(worktree: string): Promise<ProjectInfo> {
  if (worktree === ROOT_PROJECT.worktree) {
    return { ...ROOT_PROJECT };
  }

  const projects = await getProjects({ includeLinkedWorktrees: true });
  const project = projects.find((p) => p.worktree === worktree);
  if (!project) {
    throw new Error(`Project with worktree ${worktree} not found`);
  }
  return project;
}

export async function getDefaultProject(): Promise<ProjectInfo | null> {
  try {
    return await getProjectByWorktree(ROOT_PROJECT.worktree);
  } catch {
    return null;
  }
}
