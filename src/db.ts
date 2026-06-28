import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Memory, MemoryType, MemoryWithScore } from './types.js';

export const DB_PATH =
  process.env['CLAUDE_MEMORY_DB'] ?? join(homedir(), '.claude-memory', 'memory.db');

export function openDb(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
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
}

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row['id'] as number,
    repo: row['repo'] as string,
    type: row['type'] as string,
    content: row['content'] as string,
    tags: JSON.parse(row['tags'] as string) as string[],
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  };
}

export function dbSave(
  db: DatabaseSync,
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
    .get(result.lastInsertRowid) as Record<string, unknown>;
  return rowToMemory(row);
}

const BASE_FTS = `
  SELECT m.id, m.repo, m.type, m.content, m.tags, m.created_at, m.updated_at,
         fts.rank AS score
  FROM memories_fts fts
  JOIN memories m ON m.id = fts.rowid
  WHERE memories_fts MATCH ?
`;
const FTS_ORDER = `ORDER BY fts.rank, m.updated_at DESC LIMIT ?`;

export function dbRecall(
  db: DatabaseSync,
  args: { query: string; repo?: string; type?: string; limit?: number },
): MemoryWithScore[] {
  const limit = args.limit ?? 10;
  const ftsQuery = args.query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(' ');

  try {
    let rows: Record<string, unknown>[];
    if (args.repo !== undefined && args.type !== undefined) {
      rows = db
        .prepare(`${BASE_FTS} AND (m.repo = ? OR m.repo = '') AND m.type = ? ${FTS_ORDER}`)
        .all(ftsQuery, args.repo, args.type, limit) as Record<string, unknown>[];
    } else if (args.repo !== undefined) {
      rows = db
        .prepare(`${BASE_FTS} AND (m.repo = ? OR m.repo = '') ${FTS_ORDER}`)
        .all(ftsQuery, args.repo, limit) as Record<string, unknown>[];
    } else if (args.type !== undefined) {
      rows = db
        .prepare(`${BASE_FTS} AND m.type = ? ${FTS_ORDER}`)
        .all(ftsQuery, args.type, limit) as Record<string, unknown>[];
    } else {
      rows = db
        .prepare(`${BASE_FTS} ${FTS_ORDER}`)
        .all(ftsQuery, limit) as Record<string, unknown>[];
    }
    return rows.map((r) => ({ ...rowToMemory(r), score: r['score'] as number }));
  } catch {
    // Fallback: LIKE search if FTS5 query parsing fails
    const likePattern = `%${args.query}%`;
    let rows: Record<string, unknown>[];
    if (args.repo !== undefined && args.type !== undefined) {
      rows = db
        .prepare(
          `SELECT *, 0.0 AS score FROM memories
           WHERE content LIKE ? AND (repo = ? OR repo = '') AND type = ?
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(likePattern, args.repo, args.type, limit) as Record<string, unknown>[];
    } else if (args.repo !== undefined) {
      rows = db
        .prepare(
          `SELECT *, 0.0 AS score FROM memories
           WHERE content LIKE ? AND (repo = ? OR repo = '')
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(likePattern, args.repo, limit) as Record<string, unknown>[];
    } else if (args.type !== undefined) {
      rows = db
        .prepare(
          `SELECT *, 0.0 AS score FROM memories
           WHERE content LIKE ? AND type = ?
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(likePattern, args.type, limit) as Record<string, unknown>[];
    } else {
      rows = db
        .prepare(
          `SELECT *, 0.0 AS score FROM memories
           WHERE content LIKE ? ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(likePattern, limit) as Record<string, unknown>[];
    }
    return rows.map((r) => ({ ...rowToMemory(r), score: r['score'] as number }));
  }
}

export function dbBootstrap(
  db: DatabaseSync,
  repo: string,
): { repo_notes: Memory[]; global_notes: Memory[] } {
  const repoRows = db
    .prepare('SELECT * FROM memories WHERE repo = ? ORDER BY type, created_at')
    .all(repo) as Record<string, unknown>[];
  const globalRows = db
    .prepare(`SELECT * FROM memories WHERE repo = '' ORDER BY type, created_at`)
    .all() as Record<string, unknown>[];
  return {
    repo_notes: repoRows.map(rowToMemory),
    global_notes: globalRows.map(rowToMemory),
  };
}

export function dbUpdate(
  db: DatabaseSync,
  id: number,
  content: string,
): { id: number; updated_at: string } | null {
  const now = new Date().toISOString();
  const info = db
    .prepare('UPDATE memories SET content = ?, updated_at = ? WHERE id = ?')
    .run(content, now, id);
  return info.changes === 0 ? null : { id, updated_at: now };
}

export function dbDelete(db: DatabaseSync, id: number): boolean {
  return db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
}
