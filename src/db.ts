import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Memory, MemoryType, MemoryWithScore } from './types.js';

export type MemoryDb = Database.Database;

export const DB_PATH =
  process.env['CLAUDE_MEMORY_DB'] ?? join(homedir(), '.claude-memory', 'memory.db');

export function openDb(path = DB_PATH): MemoryDb {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
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

// Reciprocal Rank Fusion constants. K dampens the contribution of low-ranked items;
// 60 is the value from the original RRF paper (Cormack et al. 2009). Lexical relevance is
// the primary signal, so recency gets a fractional weight — it breaks ties and gently floats
// fresher notes up, without ever overriding a clearly better keyword match.
const RRF_K = 60;
const RRF_RECENCY_WEIGHT = 0.5;

// Assign 1-based competition ranks ("1,2,2,4") to an already-sorted list: rows the
// comparator judges equal share a rank. This matters because two notes with identical
// keyword relevance must tie on the lexical signal — otherwise RRF would reward whichever
// one SQLite happened to list first and recency could never break the tie.
function competitionRanks<T>(sorted: T[], equal: (a: T, b: T) => boolean): number[] {
  const ranks: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    ranks.push(i > 0 && equal(sorted[i] as T, sorted[i - 1] as T) ? ranks[i - 1]! : i + 1);
  }
  return ranks;
}

// Re-rank a lexically-ordered candidate pool by fusing keyword relevance with recency.
// `rows` must already be ordered best-bm25-first (that ordering *is* the lexical rank).
function rankByRrf(rows: Record<string, unknown>[]): MemoryWithScore[] {
  const bm25 = (r: Record<string, unknown>): number => Number(r['bm25_rank'] ?? 0);
  const updated = (r: Record<string, unknown>): string => String(r['updated_at']);

  const lexRanks = competitionRanks(rows, (a, b) => bm25(a) === bm25(b));
  const lexRankById = new Map<number, number>();
  rows.forEach((r, i) => lexRankById.set(r['id'] as number, lexRanks[i]!));

  const byRecency = [...rows].sort((a, b) => updated(b).localeCompare(updated(a)));
  const recRanks = competitionRanks(byRecency, (a, b) => updated(a) === updated(b));
  const recRankById = new Map<number, number>();
  byRecency.forEach((r, i) => recRankById.set(r['id'] as number, recRanks[i]!));

  return rows
    .map((r) => {
      const id = r['id'] as number;
      const lexRank = lexRankById.get(id) ?? rows.length;
      const recRank = recRankById.get(id) ?? rows.length;
      const score = 1 / (RRF_K + lexRank) + RRF_RECENCY_WEIGHT * (1 / (RRF_K + recRank));
      return { ...rowToMemory(r), score };
    })
    .sort((a, b) => b.score - a.score);
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

    // Pull a candidate pool ordered by pure lexical relevance (bm25 rank is ascending —
    // more-negative is better), then re-rank in JS with Reciprocal Rank Fusion of two
    // signals: lexical relevance and recency. RRF is scale-free (it fuses *ranks*, not raw
    // scores), so we never have to reconcile bm25's units against a hand-tuned day penalty.
    const candidatePool = Math.max(limit * 4, 50);
    const whereExtra = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
    params.push(candidatePool);
    const sql = `
      SELECT m.id, m.repo, m.type, m.content, m.tags, m.archived, m.created_at, m.updated_at,
             fts.rank AS bm25_rank
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?${whereExtra}
      ORDER BY bm25_rank ASC LIMIT ?
    `;

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rankByRrf(rows).slice(0, limit);
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

// Priority order for bootstrap: the most load-bearing context first, so that if a token
// budget forces truncation, the notes an agent most needs to see survive.
const BOOTSTRAP_TYPE_PRIORITY: Record<string, number> = {
  rules: 0,
  architecture: 1,
  deploy: 2,
  decision: 3,
  preference: 4,
  note: 5,
};

// Rough token estimate (~4 chars/token) — good enough to keep bootstrap within a context budget.
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function orderForBootstrap(rows: Record<string, unknown>[]): Memory[] {
  return rows
    .map(rowToMemory)
    .sort((a, b) => {
      const pa = BOOTSTRAP_TYPE_PRIORITY[a.type] ?? 99;
      const pb = BOOTSTRAP_TYPE_PRIORITY[b.type] ?? 99;
      if (pa !== pb) return pa - pb;
      // Within a type, freshest first.
      return b.updated_at.localeCompare(a.updated_at);
    });
}

// Trim a priority-ordered list to fit a token budget, counting from the top so the
// highest-priority notes are kept. Returns the kept notes and how many were dropped.
function applyBudget(
  notes: Memory[],
  budget: number | undefined,
): { kept: Memory[]; omitted: number } {
  if (budget === undefined || budget <= 0) return { kept: notes, omitted: 0 };
  const kept: Memory[] = [];
  let used = 0;
  for (const n of notes) {
    const cost = estimateTokens(n.content);
    if (used + cost > budget && kept.length > 0) break;
    kept.push(n);
    used += cost;
  }
  return { kept, omitted: notes.length - kept.length };
}

export function dbBootstrap(
  db: MemoryDb,
  repo: string,
  opts: { token_budget?: number } = {},
): { repo_notes: Memory[]; global_notes: Memory[]; omitted: number } {
  const repoRows = db
    .prepare('SELECT * FROM memories WHERE repo = ? AND archived = 0')
    .all(repo) as Record<string, unknown>[];
  const globalRows = db
    .prepare(`SELECT * FROM memories WHERE repo = '' AND archived = 0`)
    .all() as Record<string, unknown>[];

  const repoOrdered = orderForBootstrap(repoRows);
  const globalOrdered = orderForBootstrap(globalRows);

  // Split a shared budget: repo-specific context is more valuable, so it gets first claim
  // (two-thirds), with global notes taking the remainder.
  const budget = opts.token_budget;
  const repoBudget = budget === undefined ? undefined : Math.ceil(budget * 0.67);
  const repoTrim = applyBudget(repoOrdered, repoBudget);
  const globalBudget =
    budget === undefined
      ? undefined
      : Math.max(0, budget - repoTrim.kept.reduce((s, n) => s + estimateTokens(n.content), 0));
  const globalTrim = applyBudget(globalOrdered, globalBudget);

  return {
    repo_notes: repoTrim.kept,
    global_notes: globalTrim.kept,
    omitted: repoTrim.omitted + globalTrim.omitted,
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
