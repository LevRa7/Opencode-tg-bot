import { randomBytes } from "node:crypto";
import type { SubdomainsRepository } from "../settings/repositories/subdomains.js";
import { setServerPassword } from "../settings/manager.js";

export interface SubdomainInfo {
  userId: number;
  username: string;
  subdomain: string;
  password?: string;
  kind: string;
  hostname?: string | null;
}

export interface ResolvedSubdomain {
  userId: number;
  kind: string;
  subdomain: string;
  hostname: string | null;
  sshConnectionId: string | null;
}

export class SubdomainManager {
  constructor(private getRepo: () => SubdomainsRepository) {}

  ensureSubdomain(userId: number, username: string | undefined, kind: "host" | "tenant"): SubdomainInfo {
    const existing = this.getRepo().getByUserId(userId);
    if (existing) {
      return {
        userId: existing.user_id,
        username: existing.username,
        subdomain: existing.subdomain,
        kind: existing.kind,
        hostname: existing.hostname,
      };
    }

    const effectiveUsername = (username?.replace(/^@/, "") || `tg${userId}`).toLowerCase();
    const password = this.generatePassword();
    const now = new Date().toISOString();

    this.getRepo().upsert(userId, {
      username: effectiveUsername,
      subdomain: effectiveUsername,
      kind,
      created_at: now,
    });

    setServerPassword(userId, password);

    return {
      userId,
      username: effectiveUsername,
      subdomain: effectiveUsername,
      password,
      kind,
    };
  }

  ensureSshSubdomain(
    userId: number,
    username: string | undefined,
    hostname: string,
    kind: "ssh-host" | "ssh-docker",
    sshConnectionId: string,
  ): SubdomainInfo {
    const effectiveUsername = (username?.replace(/^@/, "") || `tg${userId}`).toLowerCase();
    const subdomain = `${hostname}.${effectiveUsername}`;
    const password = this.generatePassword();
    const now = new Date().toISOString();

    this.getRepo().upsert(userId, {
      username: effectiveUsername,
      subdomain,
      kind,
      ssh_connection_id: sshConnectionId,
      hostname,
      created_at: now,
    });

    setServerPassword(userId, password);

    return {
      userId,
      username: effectiveUsername,
      subdomain,
      password,
      kind,
      hostname,
    };
  }

  resolveSubdomain(subdomain: string): ResolvedSubdomain | null {
    const row = this.getRepo().getBySubdomain(subdomain.toLowerCase());
    if (!row) return null;
    return {
      userId: row.user_id,
      kind: row.kind,
      subdomain: row.subdomain,
      hostname: row.hostname,
      sshConnectionId: row.ssh_connection_id,
    };
  }

  getSubdomainByUserId(userId: number): ResolvedSubdomain | null {
    const row = this.getRepo().getByUserId(userId);
    if (!row) return null;
    return {
      userId: row.user_id,
      kind: row.kind,
      subdomain: row.subdomain,
      hostname: row.hostname,
      sshConnectionId: row.ssh_connection_id,
    };
  }

  regeneratePassword(userId: number): string | null {
    const row = this.getRepo().getByUserId(userId);
    if (!row) return null;
    const newPassword = this.generatePassword();
    setServerPassword(userId, newPassword);
    return newPassword;
  }

  private generatePassword(): string {
    return randomBytes(9).toString("base64url").slice(0, 12);
  }
}
