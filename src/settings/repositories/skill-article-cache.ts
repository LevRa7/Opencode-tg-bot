import type Database from "better-sqlite3";

export interface SkillArticleCacheRow {
  skill_name: string;
  skill_hash: string;
  telegraph_url: string;
  telegraph_path: string;
  key_id: number | null;
  created_at: number;
  updated_at: number;
}

export function createSkillArticleCacheRepository(db: Database.Database) {
  return {
    get(skillName: string): SkillArticleCacheRow | undefined {
      return db.prepare("SELECT * FROM skill_article_cache WHERE skill_name = ?").get(skillName) as SkillArticleCacheRow | undefined;
    },
    upsert(params: {
      skill_name: string;
      skill_hash: string;
      telegraph_url: string;
      telegraph_path: string;
      key_id?: number;
    }): void {
      const now = Date.now();
      db.prepare(`
        INSERT INTO skill_article_cache (skill_name, skill_hash, telegraph_url, telegraph_path, key_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(skill_name) DO UPDATE SET
          skill_hash = excluded.skill_hash,
          telegraph_url = excluded.telegraph_url,
          telegraph_path = excluded.telegraph_path,
          key_id = excluded.key_id,
          updated_at = excluded.updated_at
      `).run(params.skill_name, params.skill_hash, params.telegraph_url, params.telegraph_path, params.key_id ?? null, now, now);
    },
    getAll(): SkillArticleCacheRow[] {
      return db.prepare("SELECT * FROM skill_article_cache ORDER BY skill_name").all() as SkillArticleCacheRow[];
    },
  };
}
