import { Client } from "ssh2";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { encryptData, decryptData } from "./ssh-encryption.js";
import { getWorkspacesRoot } from "../runtime/paths.js";
import { logger } from "./logger.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface SshDetails {
  host: string;
  port: number;
  username: string;
}

export interface SshAuth {
  password?: string;
  privateKey?: string;
}

export interface SavedSshConnection {
  id: string;
  label: string;
  details: SshDetails;
  auth: SshAuth;
  deployTarget: "docker" | "host";
}

export interface SshConnection {
  client: Client;
  server: net.Server;
  localPort: number;
  remotePort: number;
  details: SshDetails;
  deployTarget: "docker" | "host";
}

class SshManager {
  private activeConnections = new Map<number, SshConnection>();
  private remoteHomeDirCache = new Map<number, string>();

  getActiveConnection(userId: number): SshConnection | undefined {
    return this.activeConnections.get(userId);
  }

  isSshActive(userId: number): boolean {
    return this.activeConnections.has(userId);
  }

  async executeRemoteCommand(userId: number, cmd: string): Promise<string> {
    const conn = this.activeConnections.get(userId);
    if (!conn) throw new Error("No active SSH connection");

    // When Docker target, run commands inside the container so that
    // file listings, git operations, etc. reflect the container filesystem.
    const effectiveCmd = conn.deployTarget === "docker"
      ? `docker exec opencode-serve-tg-${userId} sh -c ${JSON.stringify(cmd)}`
      : cmd;

    return new Promise<string>((resolve, reject) => {
      conn.client.exec(effectiveCmd, (err: Error | undefined, stream: any) => {
        if (err) return reject(err);
        let stdout = "";
        let stderr = "";
        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on("close", (code: number) => {
          if (code !== 0) return reject(new Error(`Command failed (exit ${code}): ${stderr}`));
          resolve(stdout);
        });
      });
    });
  }

  async getRemoteHomeDir(userId: number): Promise<string> {
    const cached = this.remoteHomeDirCache.get(userId);
    if (cached) return cached;

    const home = (await this.executeRemoteCommand(userId, "echo $HOME")).trim();
    this.remoteHomeDirCache.set(userId, home);
    return home;
  }

  async downloadRemoteFile(userId: number, remotePath: string, localPath: string): Promise<void> {
    const conn = this.activeConnections.get(userId);
    if (!conn) throw new Error("No active SSH connection");

    if (conn.deployTarget === "docker") {
      // Docker: copy file from container to host temp, then SFTP download, then cleanup
      const hostTmp = `/tmp/ssh-dl-${userId}-${Date.now()}`;
      await this.executeRemoteCommand(
        userId,
        `docker cp opencode-serve-tg-${userId}:"${remotePath}" "${hostTmp}"`
      );

      try {
        await new Promise<void>((resolve, reject) => {
          conn.client.sftp((err: Error | undefined, sftp: any) => {
            if (err) return reject(err);
            sftp.fastGet(hostTmp, localPath, (e: any) => {
              if (e) return reject(e);
              resolve();
            });
          });
        });
      } finally {
        // Cleanup host temp file (fire-and-forget)
        this.executeRemoteCommand(userId, `rm -f "${hostTmp}"`).catch(() => {});
      }
      return;
    }

    return new Promise<void>((resolve, reject) => {
      conn.client.sftp((err: Error | undefined, sftp: any) => {
        if (err) return reject(err);
        sftp.fastGet(remotePath, localPath, (e: any) => {
          if (e) return reject(e);
          resolve();
        });
      });
    });
  }

  getLocalPort(userId: number): number | undefined {
    return this.activeConnections.get(userId)?.localPort;
  }

  /**
   * Check whether the SSH tunnel is actually working by making a quick HTTP
   * request to the local tunnel endpoint.  Returns true only when the remote
   * OpenCode server responds (any HTTP status).
   * Suppresses errors internally and always returns a boolean.
   */
  async isTunnelHealthy(userId: number): Promise<boolean> {
    const localPort = this.getLocalPort(userId);
    if (!localPort) return false;

    const http = await import("node:http");
    const check = (path: string) =>
      new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${localPort}${path}`, { timeout: 3000 }, (res) => {
          res.resume();
          resolve();
        });
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("timeout"));
        });
      });

    try {
      await check("/health");
      return true;
    } catch {
      try {
        await check("/");
        return true;
      } catch {
        return false;
      }
    }
  }

  async disconnect(userId: number): Promise<void> {
    const conn = this.activeConnections.get(userId);
    if (!conn) return;

    logger.info(`[SSHManager] Disconnecting SSH for user ${userId}`);
    conn.server.close();
    conn.client.end();
    this.activeConnections.delete(userId);
    this.remoteHomeDirCache.delete(userId);
  }

  private getCredentialsPath(userId: number): string {
    return path.join(getWorkspacesRoot(), `tg-${userId}`, "state", "ssh_credentials.json");
  }

  private getConnectionsPath(userId: number): string {
    return path.join(getWorkspacesRoot(), `tg-${userId}`, "state", "ssh_connections.json");
  }

  private getKeyPath(userId: number): string {
    return path.join(getWorkspacesRoot(), `tg-${userId}`, "state", "config", "ssh_key");
  }

  private async getOrCreateEncryptionKey(userId: number): Promise<Buffer> {
    const keyFile = this.getKeyPath(userId);
    const dir = path.dirname(keyFile);
    await fs.mkdir(dir, { recursive: true });

    try {
      const existing = await fs.readFile(keyFile);
      if (existing.length === 32) {
        return existing;
      }
    } catch {
      // File doesn't exist or is invalid, generate new key
    }

    const newKey = crypto.randomBytes(32);
    await fs.writeFile(keyFile, newKey, { mode: 0o600 });
    return newKey;
  }

  private generateConnectionId(): string {
    return crypto.randomBytes(8).toString("hex");
  }

  private buildConnectionLabel(details: SshDetails, deployTarget: "docker" | "host"): string {
    const target = deployTarget === "docker" ? "docker" : "host";
    return `${details.username}@${details.host}:${details.port} (${target})`;
  }

  private async loadConnectionsList(userId: number): Promise<SavedSshConnection[]> {
    const filePath = this.getConnectionsPath(userId);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const { encrypted } = JSON.parse(content);
      const key = await this.getOrCreateEncryptionKey(userId);
      const decrypted = decryptData(encrypted, key);
      return JSON.parse(decrypted) as SavedSshConnection[];
    } catch {
      return [];
    }
  }

  private async persistConnectionsList(userId: number, connections: SavedSshConnection[]): Promise<void> {
    const filePath = this.getConnectionsPath(userId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const key = await this.getOrCreateEncryptionKey(userId);
    const data = JSON.stringify(connections);
    const encrypted = encryptData(data, key);

    await fs.writeFile(filePath, JSON.stringify({ encrypted }), { mode: 0o600 });
  }

  async saveConnection(
    userId: number,
    details: SshDetails,
    auth: SshAuth,
    deployTarget: "docker" | "host"
  ): Promise<string> {
    const connections = await this.loadConnectionsList(userId);

    const existing = connections.find(
      (c) => c.details.host === details.host && c.details.username === details.username && c.details.port === details.port
    );

    if (existing) {
      existing.details = details;
      existing.auth = auth;
      existing.deployTarget = deployTarget;
      existing.label = this.buildConnectionLabel(details, deployTarget);
      await this.persistConnectionsList(userId, connections);
      logger.info(`[SSHManager] Updated saved SSH connection ${existing.id} for user ${userId}`);
      return existing.id;
    }

    const id = this.generateConnectionId();
    const label = this.buildConnectionLabel(details, deployTarget);
    connections.push({ id, label, details, auth, deployTarget });
    await this.persistConnectionsList(userId, connections);
    logger.info(`[SSHManager] Saved new SSH connection ${id} for user ${userId}`);
    return id;
  }

  async getSavedConnections(userId: number): Promise<SavedSshConnection[]> {
    return this.loadConnectionsList(userId);
  }

  async deleteSavedConnection(userId: number, connectionId: string): Promise<void> {
    const connections = await this.loadConnectionsList(userId);
    const filtered = connections.filter((c) => c.id !== connectionId);
    await this.persistConnectionsList(userId, filtered);
    logger.info(`[SSHManager] Deleted SSH connection ${connectionId} for user ${userId}`);
  }

  async loadConnectionById(userId: number, connectionId: string): Promise<SavedSshConnection | null> {
    const connections = await this.loadConnectionsList(userId);
    return connections.find((c) => c.id === connectionId) ?? null;
  }

  async saveCredentials(
    userId: number,
    details: SshDetails,
    auth: SshAuth,
    deployTarget: "docker" | "host"
  ): Promise<void> {
    await this.saveConnection(userId, details, auth, deployTarget);
  }

  async loadCredentials(userId: number): Promise<{ details: SshDetails; auth: SshAuth; deployTarget: "docker" | "host" } | null> {
    // Try loading from old single-credential file first and migrate
    const oldStateFile = this.getCredentialsPath(userId);
    try {
      const content = await fs.readFile(oldStateFile, "utf-8");
      const { encrypted } = JSON.parse(content);
      const key = await this.getOrCreateEncryptionKey(userId);
      const decrypted = decryptData(encrypted, key);
      const creds = JSON.parse(decrypted) as { details: SshDetails; auth: SshAuth; deployTarget: "docker" | "host" };

      // Migrate to new format
      await this.saveConnection(userId, creds.details, creds.auth, creds.deployTarget);
      // Remove old file after successful migration
      await fs.unlink(oldStateFile).catch(() => {});
      logger.info(`[SSHManager] Migrated old SSH credentials to connections list for user ${userId}`);
      return creds;
    } catch {
      // No old file, try new format — return first saved connection
    }

    const connections = await this.loadConnectionsList(userId);
    if (connections.length === 0) return null;
    const first = connections[0];
    return { details: first.details, auth: first.auth, deployTarget: first.deployTarget };
  }

  private async findFreePort(): Promise<number> {
    // Range 49600 - 49999
    const min = 49600;
    const max = 49999;

    for (let port = min; port <= max; port++) {
      const portFree = await new Promise<boolean>((resolve) => {
        const testServer = net.createServer();
        testServer.once("error", () => resolve(false));
        testServer.once("listening", () => {
          testServer.close();
          resolve(true);
        });
        testServer.listen(port, "127.0.0.1");
      });

      if (portFree) {
        return port;
      }
    }

    throw new Error("No free ports available in range 49600-49999");
  }

  /**
   * Find a free port on the remote server by checking ports starting from 49600.
   * Uses `ss` or `netstat` to check which ports are in use.
   */
  private async findFreeRemotePort(
    executeCommand: (cmd: string) => Promise<string>
  ): Promise<number> {
    const min = 49600;
    const max = 49699;

    // Get list of ports currently in use on the remote server
    const usedPorts: Set<number> = new Set();
    try {
      // Try ss first (more modern), fallback to netstat
      let output = "";
      try {
        output = await executeCommand("ss -tlnH 2>/dev/null | awk '{print $4}' | grep -oE '[0-9]+$'");
      } catch {
        try {
          output = await executeCommand("netstat -tln 2>/dev/null | awk '{print $4}' | grep -oE '[0-9]+$'");
        } catch {
          // If neither works, just try ports sequentially
          output = "";
        }
      }
      for (const line of output.split("\n")) {
        const p = parseInt(line.trim(), 10);
        if (!isNaN(p)) usedPorts.add(p);
      }
    } catch {
      // Ignore errors, we'll try ports one by one
    }

    for (let port = min; port <= max; port++) {
      if (!usedPorts.has(port)) {
        logger.info(`[SSHManager] Found free remote port: ${port}`);
        return port;
      }
    }

    throw new Error(`Нет свободных портов на удаленном сервере в диапазоне ${min}-${max}`);
  }

  /**
   * Rebuild the local port-forwarding tunnel to point at the given remote port.
   * Closes the existing tunnel server and creates a new one.
   */
  private async rebuildTunnel(userId: number, remotePort: number): Promise<void> {
    const conn = this.activeConnections.get(userId);
    if (!conn) throw new Error("No active SSH connection");

    // Close the old tunnel server
    conn.server.close();

    const localPort = await this.findFreePort();

    const server = net.createServer((socket) => {
      conn.client.forwardOut(
        "127.0.0.1",
        socket.remotePort ?? 0,
        "127.0.0.1",
        remotePort,
        (err: Error | undefined, stream: any) => {
          if (err) {
            logger.error("[SSHManager] Port forward error:", err);
            socket.destroy();
            return;
          }
          socket.pipe(stream).pipe(socket);
        }
      );
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(localPort, "127.0.0.1", () => {
        logger.info(`[SSHManager] Tunnel rebuilt: 127.0.0.1:${localPort} -> remote 127.0.0.1:${remotePort}`);
        resolve();
      });
      server.on("error", reject);
    });

    server.on("error", (err) => {
      logger.error(`[SSHManager] Tunnel server error:`, err);
      this.disconnect(userId).catch(() => {});
    });

    // Update the connection record
    conn.server = server;
    conn.localPort = localPort;
    conn.remotePort = remotePort;
  }

  async connect(
    userId: number,
    details: SshDetails,
    auth: SshAuth,
    deployTarget: "docker" | "host"
  ): Promise<number> {
    // If already connected, disconnect first
    if (this.isSshActive(userId)) {
      await this.disconnect(userId);
    }

    logger.info(`[SSHManager] Connecting SSH for user ${userId} to ${details.username}@${details.host}:${details.port}`);

    return new Promise<number>((resolve, reject) => {
      const client = new Client();

      client.on("ready", async () => {
        try {
          const localPort = await this.findFreePort();

          // Create a temporary tunnel on a placeholder port.
          // The real remote port is determined during bootstrapRemoteServer(),
          // which will call rebuildTunnel() to point at the correct port.
          const tempRemotePort = 49600;

          const server = net.createServer((socket) => {
            const conn = this.activeConnections.get(userId);
            const rPort = conn?.remotePort ?? tempRemotePort;
            client.forwardOut(
              "127.0.0.1",
              socket.remotePort ?? 0,
              "127.0.0.1",
              rPort,
              (err: Error | undefined, stream: any) => {
                if (err) {
                  logger.error("[SSHManager] Port forward error:", err);
                  socket.destroy();
                  return;
                }
                socket.pipe(stream).pipe(socket);
              }
            );
          });

          server.listen(localPort, "127.0.0.1", () => {
            logger.info(`[SSHManager] SSH connection ready, temporary tunnel on 127.0.0.1:${localPort} (remote port will be set during bootstrap)`);
            this.activeConnections.set(userId, {
              client,
              server,
              localPort,
              remotePort: tempRemotePort,
              details,
              deployTarget,
            });
            resolve(localPort);
          });

          server.on("error", (err) => {
            logger.error(`[SSHManager] Tunnel server error:`, err);
            this.disconnect(userId).catch(() => {});
          });

        } catch (err) {
          client.end();
          reject(err);
        }
      });

      client.on("error", (err: Error) => {
        logger.error(`[SSHManager] SSH Client error for user ${userId}:`, err);
        this.activeConnections.delete(userId);
        reject(err);
      });

      client.on("end", () => {
        logger.info(`[SSHManager] SSH connection ended for user ${userId}`);
        this.disconnect(userId).catch(() => {});
      });

      client.connect({
        host: details.host,
        port: details.port,
        username: details.username,
        password: auth.password,
        privateKey: auth.privateKey,
        readyTimeout: 20000,
      });
    });
  }

  async bootstrapRemoteServer(userId: number): Promise<void> {
    const conn = this.activeConnections.get(userId);
    if (!conn) {
      throw new Error("No active SSH connection");
    }

    logger.info(`[SSHManager] Bootstrapping remote server for user ${userId} using target: ${conn.deployTarget}`);

    const client = conn.client;
    const executeCommand = (cmd: string): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        client.exec(cmd, (err: Error | undefined, stream: any) => {
          if (err) return reject(err);

          let stdout = "";
          let stderr = "";

          stream.on("data", (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });

          stream.on("close", (code: number) => {
            if (code !== 0) {
              reject(new Error(`Command "${cmd}" exited with code ${code}. Stderr: ${stderr}`));
            } else {
              resolve(stdout);
            }
          });
        });
      });
    };

    if (conn.deployTarget === "docker") {
      // 1. Check if docker is installed on remote server
      try {
        await executeCommand("docker --version");
      } catch {
        throw new Error("Docker не установлен на удаленном сервере. Установите Docker или выберите тип установки 'Хост-система' (Host System).");
      }

      // 2. Check if the image already exists on the remote server
      let hasRemoteImage = false;
      try {
        await executeCommand("docker image inspect opencode-tenant:latest");
        hasRemoteImage = true;
      } catch {
        hasRemoteImage = false;
      }

      // If the image is not present on the remote server, try to transfer it from the host
      if (!hasRemoteImage) {
        logger.info(`[SSHManager] Образ opencode-tenant:latest не найден на удаленном сервере. Проверяем наличие локального образа...`);
        let hasLocalImage = false;
        try {
          await execAsync("docker image inspect opencode-tenant:latest");
          hasLocalImage = true;
        } catch {
          hasLocalImage = false;
        }

        if (hasLocalImage) {
          const localTarPath = path.join("/tmp", `opencode-tenant-${userId}.tar`);
          const remoteTarPath = `.config/opencode/opencode-tenant.tar`;

          logger.info(`[SSHManager] Сохраняем локальный образ opencode-tenant:latest в ${localTarPath}...`);
          await execAsync(`docker save -o ${localTarPath} opencode-tenant:latest`);

          logger.info(`[SSHManager] Создаем удаленную директорию для образа...`);
          await executeCommand("mkdir -p .config/opencode");

          logger.info(`[SSHManager] Загружаем образ на удаленный сервер: ${remoteTarPath}...`);
          await new Promise<void>((resolve, reject) => {
            conn.client.sftp((err: Error | undefined, sftp: any) => {
              if (err) return reject(err);
              sftp.fastPut(localTarPath, remoteTarPath, (e: any) => {
                if (e) return reject(e);
                resolve();
              });
            });
          });

          logger.info(`[SSHManager] Импортируем образ на удаленном сервере...`);
          await executeCommand(`docker load -i ${remoteTarPath}`);

          logger.info(`[SSHManager] Очищаем временные файлы...`);
          await executeCommand(`rm -f ${remoteTarPath}`);
          try {
            await fs.unlink(localTarPath);
          } catch {}
        } else {
          throw new Error("Образ 'opencode-tenant:latest' не найден на удаленном сервере и отсутствует локально на хосте бота для отправки. Пожалуйста, соберите образ локально на хосте бота, выполните настройку Docker на сервере, или выберите тип установки 'Хост-система' (Host System).");
        }
      }

      // 3. Check if a container with this name already exists
      let containerExists = false;
      try {
        await executeCommand(`docker inspect opencode-serve-tg-${userId}`);
        containerExists = true;
      } catch {
        containerExists = false;
      }

      if (containerExists) {
        // Container exists — reuse it instead of recreating
        let containerRunning = false;
        try {
          const status = (
            await executeCommand(`docker inspect -f '{{.State.Status}}' opencode-serve-tg-${userId}`)
          ).trim();
          containerRunning = status === "running";
        } catch {
          // assume stopped
        }

        if (!containerRunning) {
          logger.info(`[SSHManager] Starting existing Docker container opencode-serve-tg-${userId}`);
          await executeCommand(`docker start opencode-serve-tg-${userId}`);
        }

        // Get the container's host port
        const portMapping = (
          await executeCommand(
            `docker port opencode-serve-tg-${userId} 2>/dev/null | head -1 | grep -oE '[0-9]+$'`
          )
        ).trim();
        const remotePort = parseInt(portMapping, 10);
        if (isNaN(remotePort)) {
          throw new Error(
            "Не удалось определить порт существующего Docker-контейнера. " +
            "Удалите контейнер вручную и попробуйте снова: " +
            `docker rm -f opencode-serve-tg-${userId}`
          );
        }

        logger.info(`[SSHManager] Reusing existing Docker container on port ${remotePort}`);

        // Wait for the server to become ready
        await this.waitForRemoteServerReady(executeCommand, remotePort);
        // Rebuild the SSH tunnel to point at the container's port
        await this.rebuildTunnel(userId, remotePort);
        await executeCommand(`iptables -A INPUT -p tcp --dport ${remotePort} -j ACCEPT 2>/dev/null || true`).catch(() => {});
      } else {
        // No existing container — create a fresh one

        // 4. Find a free port on the remote server
        const remotePort = await this.findFreeRemotePort(executeCommand);
        logger.info(`[SSHManager] Using remote port ${remotePort} for Docker container`);

        // 5. Kill any process that might still be holding this port
        await executeCommand(`fuser -k ${remotePort}/tcp 2>/dev/null || true`);

        // 6. Start the opencode server container
        const volumeName = `opencode-data-tg-${userId}`;
        // Ensure volume exists
        await executeCommand(`docker volume create ${volumeName}`).catch(() => {});
        const dockerCmd = `docker run -d --name opencode-serve-tg-${userId} -v ${volumeName}:/root/.local/share/opencode -p ${remotePort}:${remotePort} -e OPENCODE_DISABLE_EXTERNAL_SKILLS=true opencode-tenant:latest serve --hostname 0.0.0.0 --port ${remotePort}`;
        try {
          await executeCommand(dockerCmd);
        } catch (err) {
          throw new Error(`Не удалось запустить Docker-контейнер. Убедитесь, что образ 'opencode-tenant:latest' собран на удаленном сервере, или выберите тип установки 'Хост-система' (Host System). Детали: ${(err as Error).message}`);
        }
        logger.info(`[SSHManager] OpenCode server Docker container started on remote server (port ${remotePort})`);

        // 7. Wait for the server inside the container to become ready
        await this.waitForRemoteServerReady(executeCommand, remotePort);

        // 8. Rebuild the SSH tunnel to point at the actual remote port
        await this.rebuildTunnel(userId, remotePort);
      }

      // 9. Verify the tunnel actually works before declaring success
      const healthy = await this.isTunnelHealthy(userId);
      if (!healthy) {
        logger.error(`[SSHManager] Tunnel verification failed after Docker bootstrap for user ${userId}`);
        throw new Error(
          "Туннель SSH установлен, но OpenCode сервер внутри Docker-контейнера не отвечает. " +
          "Проверьте логи контейнера на удаленном сервере: " +
          `docker logs opencode-serve-tg-${userId}`
        );
      }
      logger.info(`[SSHManager] SSH tunnel verified healthy after Docker bootstrap for user ${userId}`);
    } else {
      // 1. Host installation: Unpack docker image context/files and native skills directly on host
      // Upload skills and helper scripts using SFTP
      await this.uploadSkillsAndHelpers(userId);

      // 2. Start OpenCode server directly on remote host
      // We will check if `opencode` is installed, otherwise run with npm/npx
      let serveExecutable = "opencode";
      try {
        await executeCommand("which opencode");
      } catch {
        // If not installed globally, attempt to install globally or use npx fallback
        try {
          logger.info("[SSHManager] 'opencode' not found. Attempting to install globally via npm...");
          await executeCommand("npm install -g opencode-ai");
        } catch {
          logger.warn("[SSHManager] Global npm install failed or not permitted. Falling back to npx.");
          serveExecutable = "npx opencode-ai";
        }
      }

      // 3. Find a free port on the remote server
      const remotePort = await this.findFreeRemotePort(executeCommand);
      logger.info(`[SSHManager] Using remote port ${remotePort} for host process`);

      // Kill any process that might still be holding this port
      await executeCommand(`fuser -k ${remotePort}/tcp 2>/dev/null || true`);

      // 4. Start opencode serve on remote host with custom PATH prepended
      const startCmd = `export PATH=$HOME/.config/opencode/bin:$PATH && nohup ${serveExecutable} serve --port ${remotePort} > /tmp/opencode.log 2>&1 &`;
      await executeCommand(startCmd);
      logger.info(`[SSHManager] OpenCode server process started on remote host (port ${remotePort})`);

      // 5. Wait for the server to become ready
      await this.waitForRemoteServerReady(executeCommand, remotePort);

      // 6. Rebuild the SSH tunnel to point at the actual remote port
      await this.rebuildTunnel(userId, remotePort);

      // 7. Verify the tunnel actually works before declaring success
      const healthy = await this.isTunnelHealthy(userId);
      if (!healthy) {
        logger.error(`[SSHManager] Tunnel verification failed after host bootstrap for user ${userId}`);
        throw new Error(
          "Туннель SSH установлен, но OpenCode сервер на удаленном хосте не отвечает. " +
          "Проверьте логи на удаленном сервере: /tmp/opencode.log"
        );
      }
      logger.info(`[SSHManager] SSH tunnel verified healthy after host bootstrap for user ${userId}`);
    }
  }

  /**
   * Poll the remote server until it responds to HTTP health checks.
   * Retries every 2 seconds for up to 30 seconds.
   */
  private async waitForRemoteServerReady(
    executeCommand: (cmd: string) => Promise<string>,
    port: number,
  ): Promise<void> {
    const maxAttempts = 15;
    const intervalMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await executeCommand(`curl -sf http://127.0.0.1:${port}/health 2>/dev/null || curl -sf http://127.0.0.1:${port}/ 2>/dev/null`);
        logger.info(`[SSHManager] Remote server is ready on port ${port} (attempt ${attempt})`);
        return;
      } catch {
        logger.debug(`[SSHManager] Waiting for remote server on port ${port}... (attempt ${attempt}/${maxAttempts})`);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }
    }

    logger.warn(`[SSHManager] Remote server on port ${port} did not respond after ${maxAttempts} attempts, proceeding anyway`);
  }

  private async uploadSkillsAndHelpers(userId: number): Promise<void> {
    const conn = this.activeConnections.get(userId);
    if (!conn) return;

    logger.info(`[SSHManager] Uploading skills and helper files via SFTP`);

    return new Promise<void>((resolve, reject) => {
      conn.client.sftp(async (err: Error | undefined, sftp: any) => {
        if (err) return reject(err);

        try {
          // Helper to create directories recursively on remote server
          const mkdirp = async (remotePath: string) => {
            const parts = remotePath.split("/").filter(Boolean);
            const isAbsolute = remotePath.startsWith("/");
            let current = isAbsolute ? "" : ".";
            for (const part of parts) {
              current += "/" + part;
              await new Promise<void>((res) => {
                sftp.mkdir(current, (e: any) => {
                  // Ignore if directory already exists
                  res();
                });
              });
            }
          };

          // Define local skills path and remote skills path
          const remoteSkillsDir = `.config/opencode/skills`;
          await mkdirp(remoteSkillsDir);

          // Upload Native Skills: tg-cli, openai-media-transcriber, gpt-image-api
          // 1. tg-cli (source: docker/vendor/python-tg-cli/SKILL.md)
          const tgCliLocalSkill = "docker/vendor/python-tg-cli/SKILL.md";
          await mkdirp(`${remoteSkillsDir}/tg-cli`);
          await new Promise<void>((res, rej) => {
            sftp.fastPut(tgCliLocalSkill, `${remoteSkillsDir}/tg-cli/SKILL.md`, (e: any) => e ? rej(e) : res());
          });

          // 2. openai-media-transcriber (source: docker/skills/openai-media-transcriber/SKILL.md)
          const transLocalSkill = "docker/skills/openai-media-transcriber/SKILL.md";
          await mkdirp(`${remoteSkillsDir}/openai-media-transcriber`);
          await new Promise<void>((res, rej) => {
            sftp.fastPut(transLocalSkill, `${remoteSkillsDir}/openai-media-transcriber/SKILL.md`, (e: any) => e ? rej(e) : res());
          });

          // 3. gpt-image-api (source: docker/skills/gpt-image-api/SKILL.md)
          const gptLocalSkill = "docker/skills/gpt-image-api/SKILL.md";
          await mkdirp(`${remoteSkillsDir}/gpt-image-api`);
          await new Promise<void>((res, rej) => {
            sftp.fastPut(gptLocalSkill, `${remoteSkillsDir}/gpt-image-api/SKILL.md`, (e: any) => e ? rej(e) : res());
          });

          // Define local bin path and remote bin path for tenant docker image context/helper files
          const remoteBinDir = `.config/opencode/bin`;
          await mkdirp(remoteBinDir);

          const helpers = [
            { local: "docker/bin/opencode-gemini-media", remote: "opencode-gemini-media" },
            { local: "docker/bin/gemini-media-proxy.mjs", remote: "gemini-media-proxy.mjs" },
            { local: "docker/bin/opencode-gpt-image", remote: "opencode-gpt-image" },
            { local: "docker/bin/gpt-image-proxy.mjs", remote: "gpt-image-proxy.mjs" },
            { local: "docker/bin/tg-cli-wrapper.sh", remote: "opencode-tg-cli" },
            { local: "docker/bin/ensure-tenant-python-env.sh", remote: "ensure-tenant-python-env.sh" },
            { local: "docker/bin/merge-agents.sh", remote: "merge-agents" },
            { local: "docker/batch-transcribe.sh", remote: "batch-transcribe" },
            { local: "docker/batch-transcribe.mjs", remote: "batch-transcribe-node" }
          ];

          for (const helper of helpers) {
            await new Promise<void>((res, rej) => {
              sftp.fastPut(helper.local, `${remoteBinDir}/${helper.remote}`, (e: any) => e ? rej(e) : res());
            });
            // Make executable
            await new Promise<void>((res) => {
              sftp.chmod(`${remoteBinDir}/${helper.remote}`, 0o755, () => res());
            });
          }

          // Upload AGENTS.md
          const localAgentsFile = "docker/AGENTS.md";
          await new Promise<void>((res, rej) => {
            sftp.fastPut(localAgentsFile, `.config/opencode/AGENTS.md`, (e: any) => e ? rej(e) : res());
          });

          logger.info(`[SSHManager] Skills and helper files successfully uploaded to remote server`);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async recoverAll(): Promise<void> {
    const workspacesRoot = getWorkspacesRoot();
    try {
      const entries = await fs.readdir(workspacesRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith("tg-")) {
          continue;
        }

        const userId = parseInt(entry.name.slice(3), 10);
        if (Number.isNaN(userId)) continue;

        const credentials = await this.loadCredentials(userId);
        if (!credentials) continue;

        logger.info(`[SSHManager] Background recovering SSH connection for user ${userId}`);
        try {
          await this.connect(userId, credentials.details, credentials.auth, credentials.deployTarget);
          await this.bootstrapRemoteServer(userId);
          logger.info(`[SSHManager] Background recovered SSH connection successfully for user ${userId}`);
        } catch (err) {
          logger.error(`[SSHManager] Failed to recover SSH connection for user ${userId}:`, err);
          // Clean up the broken connection
          await this.disconnect(userId).catch(() => {});
        }
      }
    } catch (err) {
      logger.error("[SSHManager] Failed during recoverAll:", err);
    }
  }
}

export const sshManager = new SshManager();
