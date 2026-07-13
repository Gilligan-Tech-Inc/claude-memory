// Storage-layer tests for claude-memory.
// Run: npm test   (builds first, then `node --test test/*.test.mjs`)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const db = await import('../dist/db.js');

// Each test gets its own throwaway database file for isolation.
function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-memory-test-'));
  const conn = db.openDb(join(dir, 'memory.db'));
  try {
    return fn(conn);
  } finally {
    conn.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('save persists content, tags, and incrementing ids', () => {
  withDb((conn) => {
    const a = db.dbSave(conn, { content: 'use async/await everywhere', type: 'rules', repo: 'app', tags: ['style'] });
    const b = db.dbSave(conn, { content: 'deploy via deploy.sh to colin', type: 'deploy', repo: 'app' });
    assert.ok(a.id >= 1 && b.id === a.id + 1, 'ids increment');
    assert.deepEqual(a.tags, ['style'], 'tags round-trip as array');
    assert.equal(a.type, 'rules');
  });
});

test('recall finds by keyword and scopes to repo + global', () => {
  withDb((conn) => {
    const b = db.dbSave(conn, { content: 'deploy via deploy.sh to colin', type: 'deploy', repo: 'app' });
    const g = db.dbSave(conn, { content: 'prefer terse responses', type: 'preference', repo: '' });
    db.dbSave(conn, { content: 'unrelated note in other repo', type: 'note', repo: 'other' });

    assert.ok(db.dbRecall(conn, { query: 'deploy', repo: 'app' }).some((m) => m.id === b.id), 'finds repo note');
    assert.ok(db.dbRecall(conn, { query: 'terse', repo: 'app' }).some((m) => m.id === g.id), 'global note surfaces for any repo');
    // A repo-scoped recall must not return another repo's private note.
    const appHits = db.dbRecall(conn, { query: 'note', repo: 'app' });
    assert.ok(!appHits.some((m) => m.repo === 'other'), 'other repo note excluded when scoped to app');
  });
});

test('recall type filter narrows results', () => {
  withDb((conn) => {
    db.dbSave(conn, { content: 'async rules note', type: 'rules', repo: 'app' });
    db.dbSave(conn, { content: 'async deploy note', type: 'deploy', repo: 'app' });
    const hits = db.dbRecall(conn, { query: 'async', repo: 'app', type: 'rules' });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].type, 'rules');
  });
});

test('recall tolerates FTS special characters (LIKE fallback)', () => {
  withDb((conn) => {
    const m = db.dbSave(conn, { content: 'handle the C++ operator" edge-case', type: 'note', repo: 'app' });
    // A raw query with FTS-hostile characters must not throw and should still find the note.
    const hits = db.dbRecall(conn, { query: 'C++ operator"', repo: 'app' });
    assert.ok(hits.some((h) => h.id === m.id), 'special-char query still recalls the note');
  });
});

test('recency-weighted ranking: fresh note ranks above stale note for same keyword', () => {
  withDb((conn) => {
    const stale = db.dbSave(conn, { content: 'ranking keyword stale note', type: 'note', repo: 'app' });
    conn.prepare("UPDATE memories SET updated_at = datetime('now', '-60 days') WHERE id = ?").run(stale.id);
    const fresh = db.dbSave(conn, { content: 'ranking keyword fresh note', type: 'note', repo: 'app' });
    const ranked = db.dbRecall(conn, { query: 'ranking keyword', repo: 'app' });
    assert.ok(
      ranked.findIndex((m) => m.id === fresh.id) < ranked.findIndex((m) => m.id === stale.id),
      'fresh note precedes stale note',
    );
  });
});

test('update changes content and updated_at; missing id returns null', () => {
  withDb((conn) => {
    const a = db.dbSave(conn, { content: 'use async/await', type: 'rules', repo: 'app' });
    const upd = db.dbUpdate(conn, a.id, 'use async/await and avoid callbacks');
    assert.ok(upd && typeof upd.updated_at === 'string');
    assert.ok(db.dbRecall(conn, { query: 'callbacks', repo: 'app' }).some((m) => m.id === a.id));
    assert.equal(db.dbUpdate(conn, 99999, 'x'), null);
  });
});

test('archive hides from recall and bootstrap; unarchive restores; missing id returns null', () => {
  withDb((conn) => {
    const a = db.dbSave(conn, { content: 'archivable callbacks note', type: 'note', repo: 'app' });
    const arc = db.dbArchive(conn, a.id, true);
    assert.ok(arc && arc.archived === true);
    assert.ok(!db.dbRecall(conn, { query: 'callbacks', repo: 'app' }).some((m) => m.id === a.id), 'hidden from recall');
    assert.ok(!db.dbBootstrap(conn, 'app').repo_notes.some((m) => m.id === a.id), 'hidden from bootstrap');
    assert.ok(
      db.dbRecall(conn, { query: 'callbacks', repo: 'app', include_archived: true }).some((m) => m.id === a.id),
      'visible with include_archived',
    );
    assert.ok(db.dbArchive(conn, a.id, false).archived === false);
    assert.ok(db.dbRecall(conn, { query: 'callbacks', repo: 'app' }).some((m) => m.id === a.id), 'restored after unarchive');
    assert.equal(db.dbArchive(conn, 99999, true), null);
  });
});

test('bootstrap returns repo notes and global notes separately', () => {
  withDb((conn) => {
    db.dbSave(conn, { content: 'repo note one', type: 'rules', repo: 'app' });
    db.dbSave(conn, { content: 'repo note two', type: 'deploy', repo: 'app' });
    db.dbSave(conn, { content: 'a global preference', type: 'preference', repo: '' });
    const boot = db.dbBootstrap(conn, 'app');
    assert.equal(boot.repo_notes.length, 2);
    assert.equal(boot.global_notes.length, 1);
  });
});

test('bootstrap orders by type priority (rules/architecture before note)', () => {
  withDb((conn) => {
    db.dbSave(conn, { content: 'a plain note', type: 'note', repo: 'app' });
    db.dbSave(conn, { content: 'the architecture', type: 'architecture', repo: 'app' });
    db.dbSave(conn, { content: 'the rules', type: 'rules', repo: 'app' });
    const boot = db.dbBootstrap(conn, 'app');
    assert.deepEqual(
      boot.repo_notes.map((m) => m.type),
      ['rules', 'architecture', 'note'],
      'rules first, architecture next, note last',
    );
  });
});

test('bootstrap token_budget keeps high-priority notes and reports omitted count', () => {
  withDb((conn) => {
    // ~50 tokens each (200 chars / 4). rules is highest priority and must survive.
    const big = (label) => `${label} `.repeat(50).trim();
    db.dbSave(conn, { content: big('rules'), type: 'rules', repo: 'app' });
    db.dbSave(conn, { content: big('note-one'), type: 'note', repo: 'app' });
    db.dbSave(conn, { content: big('note-two'), type: 'note', repo: 'app' });

    const boot = db.dbBootstrap(conn, 'app', { token_budget: 120 });
    assert.ok(boot.omitted >= 1, 'at least one note omitted under a tight budget');
    assert.ok(boot.repo_notes.some((m) => m.type === 'rules'), 'the rules note is always kept');
    assert.ok(boot.repo_notes.length < 3, 'not everything fits');

    // No budget = everything returned, nothing omitted.
    const full = db.dbBootstrap(conn, 'app');
    assert.equal(full.omitted, 0);
    assert.equal(full.repo_notes.length, 3);
  });
});

test('tag filter AND-matches across multiple tags', () => {
  withDb((conn) => {
    const both = db.dbSave(conn, { content: 'auth uses JWT tokens', type: 'architecture', repo: 'app', tags: ['auth', 'security'] });
    const one = db.dbSave(conn, { content: 'rate limiting on auth routes', type: 'rules', repo: 'app', tags: ['auth', 'performance'] });
    const andHits = db.dbRecall(conn, { query: 'auth', repo: 'app', tags: ['auth', 'security'] });
    assert.ok(andHits.some((m) => m.id === both.id), 'note with both tags included');
    assert.ok(!andHits.some((m) => m.id === one.id), 'note missing a required tag excluded');
  });
});

test('stats count by repo and type', () => {
  withDb((conn) => {
    db.dbSave(conn, { content: 'x', type: 'rules', repo: 'app' });
    db.dbSave(conn, { content: 'y', type: 'note', repo: 'other' });
    const stats = db.dbStats(conn);
    assert.ok(stats.total >= 2);
    assert.ok(stats.repo_count >= 2);
    assert.ok(stats.rows.every((r) => typeof r.repo === 'string' && typeof r.type === 'string' && r.count >= 1));
  });
});

test('list paginates with a stable order across offsets', () => {
  withDb((conn) => {
    const ids = [];
    for (let i = 0; i < 7; i++) ids.push(db.dbSave(conn, { content: `paged note ${i}`, type: 'note', repo: 'app' }).id);

    const page1 = db.dbList(conn, { repo: 'app', limit: 5, offset: 0 });
    const page2 = db.dbList(conn, { repo: 'app', limit: 5, offset: 5 });

    assert.equal(page1.total, 7, 'total reflects all rows, not the page');
    assert.equal(page1.memories.length, 5, 'first page respects limit');
    assert.equal(page2.memories.length, 2, 'second page holds the remainder');

    // Real pagination check (the old smoke test asserted a field that never existed):
    // the two pages must be disjoint and together cover every id exactly once.
    const p1 = new Set(page1.memories.map((m) => m.id));
    const p2 = page2.memories.map((m) => m.id);
    assert.ok(p2.every((id) => !p1.has(id)), 'pages do not overlap');
    const seen = new Set([...p1, ...p2]);
    assert.equal(seen.size, 7, 'pages cover all rows with no duplicates');
  });
});

test('export then import (merge) copies rows into a new repo', () => {
  withDb((conn) => {
    db.dbSave(conn, { content: 'exportable rule', type: 'rules', repo: 'app', tags: ['t'] });
    db.dbSave(conn, { content: 'exportable deploy', type: 'deploy', repo: 'app' });
    const exported = db.dbExport(conn, 'app');
    assert.ok(Array.isArray(exported) && exported.length === 2);

    const merge = db.dbImport(conn, exported.map((m) => ({ ...m, repo: 'app-copy' })), 'merge');
    assert.equal(merge.inserted, 2);
    assert.equal(merge.deleted, 0);
    assert.equal(db.dbList(conn, { repo: 'app-copy' }).total, 2);
  });
});

test('import (replace) wipes the target repo then inserts', () => {
  withDb((conn) => {
    db.dbSave(conn, { content: 'old one', type: 'note', repo: 'app-copy' });
    db.dbSave(conn, { content: 'old two', type: 'note', repo: 'app-copy' });
    const res = db.dbImport(
      conn,
      [{ repo: 'app-copy', type: 'note', content: 'replacement', tags: [], archived: false }],
      'replace',
      'app-copy',
    );
    assert.equal(res.deleted, 2);
    assert.equal(res.inserted, 1);
    assert.equal(db.dbList(conn, { repo: 'app-copy' }).total, 1);
  });
});

test('delete removes the row and returns false for a missing id', () => {
  withDb((conn) => {
    const a = db.dbSave(conn, { content: 'deletable deploy note', type: 'deploy', repo: 'app' });
    assert.equal(db.dbDelete(conn, a.id), true);
    assert.ok(!db.dbRecall(conn, { query: 'deletable', repo: 'app' }).some((m) => m.id === a.id));
    assert.equal(db.dbDelete(conn, 99999), false);
  });
});
