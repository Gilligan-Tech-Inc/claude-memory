import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Memory, MemoryType, MemoryWithScore } from './types.js';

export type MemoryDb = Database.Database;

export const DB_PATH =
  process.env['CLAUDE_MEMORY_DB'] ?? join(homedir(), '.claude-memory', 'memory.db');

export function openDb(): MemoryDb {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: MemoryDb): void {
  // v0 — initial schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      repo       TEXT NOT NULL DEFAULT '',
      type       TEXT NOT NULL DEFAULT 'note',
      content    TEXT NOT NULL,
      tags       TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
      USING fts5(content, repo, tags, content='memories', content_rowid='id');

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, repo, tags)
        VALUES (new.id, new.content, new.repo, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, repo, tags)
        VALUES ('delete', old.id, old.content, old.repo, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, repo, tags)
        VALUES ('delete', old.id, old.content, old.repo, old.tags);
      INSERT INTO memories_fts(rowid, content, repo, tags)
        VALUES (new.id, new.content, new.repo, new.tags);
    END;
  `);

  const version = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  // v1 — add archived column (soft-delete)
  if (version < 1) {
    db.exec(`ALTER TABLE memories ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
    db.pragma('user_version = 1');
  }
}

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row['id'] as number,
    repo: row['repo'] as string,
    type: row['type'] as string,
    content: row['content'] as string,
    tags: JSON.parse(row['tags'] as string) as string[],
    archived: (row['archived'] as number) === 1,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  };
}

export function dbSave(
  db: MemoryDb,
  args: { content: string; type?: MemoryType; repo?: string; tags?: string[] },
): Memory {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO memories (repo, type, content, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.repo ?? '',
      args.type ?? 'note',
      args.content,
      JSON.stringify(args.tags ?? []),
      now,
      now,
    );
  const row = db
    .prepare('SELECT * FROM memories WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as Record<string, unknown>;
  return rowToMemory(row);
}

export function dbRecall(
  db: MemoryDb,
  args: {
    query: string;
    repo?: string;
    type?: string;
    tags?: string[];
    limit?: number;
    include_archived?: boolean;
  },
): MemoryWithScore[] {
  const limit = args.limit ?? 10;
  const includeArchived = args.include_archived ?? false;
  const tags = args.tags ?? [];
  const ftsQuery = args.query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(' ');

  try {
    const conditions: string[] = [];
    const params: unknown[] = [ftsQuery];

    if (!includeArchived) conditions.push('m.archived = 0');
    if (args.repo !== undefined) {
      conditions.push("(m.repo = ? OR m.repo = '')");
      params.push(args.repo);
    }
    if (args.type !== undefined) {
      conditions.push('m.type = ?');
      params.push(args.type);
    }
    for (const tag of tags) {
      conditions.push('EXISTS (SELECT 1 FROM json_each(m.tags) WHERE value = ?)');
      params.push(tag);
    }
    params.push(limit);

    const whereExtra = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
    const sql = `
      SELECT m.id, m.repo, m.type, m.content, m.tags, m.archived, m.created_at, m.updated_at,
             (fts.rank + 0.03 * (julianday('now') - julianday(m.updated_at))) AS score
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?${whereExtra}
      ORDER BY score ASC LIMIT ?
    `;

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({ ...rowToMemory(r), score: r['score'] as number }));
  } catch {
    // Fallback: LIKE search if FTS5 query parsing fails
    const likePattern = `%${args.query}%`;
    const conditions: string[] = ['content LIKE ?'];
    const params: unknown[] = [likePattern];

    if (!includeArchived) conditions.push('archived = 0');
    if (args.repo !== undefined) {
      conditions.push("(repo = ? OR repo = '')");
      params.push(args.repo);
    }
    if (args.type !== undefined) {
      conditions.push('type = ?');
      params.push(args.type);
    }
    for (const tag of tags) {
      conditions.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)');
      params.push(tag);
    }
    params.push(limit);

    const sql = `SELECT *, 0.0 AS score FROM memories WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({ ...rowToMemory(r), score: r['score'] as number }));
  }
}

export function dbBootstrap(
  db: MemoryDb,
  repo: string,
): { repo_notes: Memory[]; global_notes: Memory[] } {
  const repoRows = db
    .prepare('SELECT * FROM memories WHERE repo = ? AND archived = 0 ORDER BY type, created_at')
    .all(repo) as Record<string, unknown>[];
  const globalRows = db
    .prepare(`SELECT * FROM memories WHERE repo = '' AND archived = 0 ORDER BY type, created_at`)
    .all() as Record<string, unknown>[];
  return {
    repo_notes: repoRows.map(rowToMemory),
    global_notes: globalRows.map(rowToMemory),
  };
}

export function dbArchive(
  db: MemoryDb,
  id: number,
  archived: boolean,
): { id: number; archived: boolean } | null {
  const info = db
    .prepare('UPDATE memories SET archived = ? WHERE id = ?')
    .run(archived ? 1 : 0, id);
  return info.changes === 0 ? null : { id, archived };
}

export function dbUpdate(
  db: MemoryDb,
  id: number,
  content: string,
): { id: number; updated_at: string } | null {
  const now = new Date().toISOString();
  const info = db
    .prepare('UPDATE memories SET content = ?, updated_at = ? WHERE id = ?')
    .run(content, now, id);
  return info.changes === 0 ? null : { id, updated_at: now };
}

export function dbDelete(db: MemoryDb, id: number): boolean {
  return db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
}

export function dbStats(db: MemoryDb): {
  total: number;
  repo_count: number;
  rows: Array<{ repo: string; type: string; count: number }>;
} {
  const rows = db
    .prepare(
      `SELECT repo, type, COUNT(*) AS count FROM memories
       WHERE archived = 0 GROUP BY repo, type ORDER BY repo, type`,
    )
    .all() as Array<{ repo: string; type: string; count: number }>;
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const repo_count = new Set(rows.map((r) => r.repo)).size;
  return { total, repo_count, rows };
}

export function dbList(
  db: MemoryDb,
  args: { repo?: string; limit?: number; offset?: number; include_archived?: boolean },
): { memories: Memory[]; total: number } {
  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;
  const includeArchived = args.include_archived ?? false;

  const conditions: string[] = [];
  const filterParams: unknown[] = [];
  if (args.repo !== undefined) {
    conditions.push('repo = ?');
    filterParams.push(args.repo);
  }
  if (!includeArchived) conditions.push('archived = 0');

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM memories ${where}`).get(...filterParams) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(
      `SELECT * FROM memories ${where} ORDER BY repo, type, updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...filterParams, limit, offset) as Record<string, unknown>[];
  return { memories: rows.map(rowToMemory), total };
}

export function dbExport(db: MemoryDb, repo?: string): Memory[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (repo !== undefined) {
    conditions.push('repo = ?');
    params.push(repo);
  }
  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const rows = db
    .prepare(`SELECT * FROM memories ${where} ORDER BY id`)
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToMemory);
}

type ImportRecord = Omit<Memory, 'id' | 'created_at' | 'updated_at'> & {
  created_at?: string;
  updated_at?: string;
};

export function dbImport(
  db: MemoryDb,
  records: ImportRecord[],
  mode: 'merge' | 'replace',
  repo?: string,
): { inserted: number; deleted: number } {
  let deleted = 0;

  const run = db.transaction(() => {
    if (mode === 'replace') {
      const conditions: string[] = [];
      const delParams: unknown[] = [];
      if (repo !== undefined) {
        conditions.push('repo = ?');
        delParams.push(repo);
      }
      const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
      deleted = db.prepare(`DELETE FROM memories ${where}`).run(...delParams).changes;
    }

    const insert = db.prepare(
      `INSERT INTO memories (repo, type, content, tags, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of records) {
      const now = new Date().toISOString();
      insert.run(
        m.repo,
        m.type,
        m.content,
        JSON.stringify(m.tags),
        m.archived ? 1 : 0,
        m.created_at ?? now,
        m.updated_at ?? now,
      );
    }
  });

  run();
  return { inserted: records.length, deleted };
}
