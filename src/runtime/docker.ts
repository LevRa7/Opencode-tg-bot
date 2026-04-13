import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STOP_BOT_CONTAINERS_SCRIPT_PATH = fileURLToPath(
  new URL("../../docker/stop-opencode-containers.sh", import.meta.url),
);
const STOP_BOT_CONTAINERS_TIMEOUT_MS = 30_000;

export async function stopBotContainers(): Promise<void> {
  await execFileAsync("bash", [STOP_BOT_CONTAINERS_SCRIPT_PATH], {
    env: process.env,
    maxBuffer: 1024 * 1024,
    timeout: STOP_BOT_CONTAINERS_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
}
