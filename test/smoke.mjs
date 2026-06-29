// Smoke test for the claude-memory storage layer.
// Runs against a throwaway DB by setting CLAUDE_MEMORY_DB before importing dist.
// Run: node test/smoke.mjs   (after `npm run build`)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'claude-memory-smoke-'));
process.env.CLAUDE_MEMORY_DB = join(dir, 'memory.db');

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}`);
  }
}

try {
  const { openDb, dbSave, dbRecall, dbBootstrap, dbUpdate, dbDelete, dbArchive, dbStats, dbList, dbExport, dbImport } = await import(
    '../dist/db.js'
  );
  const db = openDb();

  // save
  const a = dbSave(db, { content: 'use async/await everywhere', type: 'rules', repo: 'app', tags: ['style'] });
  const b = dbSave(db, { content: 'deploy via deploy.sh to colin', type: 'deploy', repo: 'app' });
  const g = dbSave(db, { content: 'prefer terse responses', type: 'preference', repo: '' });
  check('save returns incrementing ids', a.id >= 1 && b.id === a.id + 1);
  check('save persists tags as array', Array.isArray(a.tags) && a.tags[0] === 'style');

  // recall (FTS BM25)
  const hits = dbRecall(db, { query: 'deploy', repo: 'app' });
  check('recall finds deploy note', hits.some((m) => m.id === b.id));
  check('recall scopes to repo + global', dbRecall(db, { query: 'terse', repo: 'app' }).some((m) => m.id === g.id));
  check('recall type filter works', dbRecall(db, { query: 'async', repo: 'app', type: 'rules' }).length === 1);

  // bootstrap
  const boot = dbBootstrap(db, 'app');
  check('bootstrap returns repo notes', boot.repo_notes.length === 2);
  check('bootstrap returns global notes', boot.global_notes.length === 1);

  // update
  const upd = dbUpdate(db, a.id, 'use async/await and avoid callbacks');
  check('update returns new updated_at', upd && typeof upd.updated_at === 'string');
  check('update reflected in recall', dbRecall(db, { query: 'callbacks', repo: 'app' }).some((m) => m.id === a.id));
  check('update of missing id returns null', dbUpdate(db, 99999, 'x') === null);

  // archive / unarchive
  const arc = dbArchive(db, a.id, true);
  check('archive returns id+flag', arc !== null && arc.archived === true);
  check('archived note hidden from recall', !dbRecall(db, { query: 'callbacks', repo: 'app' }).some((m) => m.id === a.id));
  check('archived note hidden from bootstrap', !dbBootstrap(db, 'app').repo_notes.some((m) => m.id === a.id));
  check('archived note visible with include_archived', dbRecall(db, { query: 'callbacks', repo: 'app', include_archived: true }).some((m) => m.id === a.id));
  const unarc = dbArchive(db, a.id, false);
  check('unarchive returns flag=false', unarc !== null && unarc.archived === false);
  check('unarchived note back in recall', dbRecall(db, { query: 'callbacks', repo: 'app' }).some((m) => m.id === a.id));
  check('archive of missing id returns null', dbArchive(db, 99999, true) === null);

  // tag filtering
  const t1 = dbSave(db, { content: 'auth uses JWT tokens', type: 'architecture', repo: 'app', tags: ['auth', 'security'] });
  const t2 = dbSave(db, { content: 'rate limiting on auth routes', type: 'rules', repo: 'app', tags: ['auth', 'performance'] });
  const t3 = dbSave(db, { content: 'cors policy for api', type: 'rules', repo: 'app', tags: ['security'] });
  const authHits = dbRecall(db, { query: 'auth', repo: 'app', tags: ['auth'] });
  check('tag filter includes matching notes', authHits.some((m) => m.id === t1.id) && authHits.some((m) => m.id === t2.id));
  check('tag filter excludes non-matching notes', !authHits.some((m) => m.id === t3.id));
  const andHits = dbRecall(db, { query: 'auth security', repo: 'app', tags: ['auth', 'security'] });
  check('AND-match tags: only note with both tags returned', andHits.some((m) => m.id === t1.id) && !andHits.some((m) => m.id === t2.id));

  // recency-weighted ranking: save two notes with same keyword, different ages
  const old1 = dbSave(db, { content: 'ranking keyword old note', type: 'note', repo: 'app' });
  // backdate old1 so it appears stale
  db.prepare("UPDATE memories SET updated_at = datetime('now', '-60 days') WHERE id = ?").run(old1.id);
  const new1 = dbSave(db, { content: 'ranking keyword fresh note', type: 'note', repo: 'app' });
  const ranked = dbRecall(db, { query: 'ranking keyword', repo: 'app' });
  check('recency ranking: fresh note ranks above stale note', ranked.findIndex((m) => m.id === new1.id) < ranked.findIndex((m) => m.id === old1.id));

  // stats
  const stats = dbStats(db);
  check('stats total > 0', stats.total > 0);
  check('stats repo_count >= 2', stats.repo_count >= 2);
  check('stats rows have repo/type/count', stats.rows.every((r) => typeof r.repo === 'string' && typeof r.type === 'string' && r.count >= 1));

  // list
  const listed = dbList(db, { repo: 'app', limit: 5, offset: 0 });
  check('list returns memories array', Array.isArray(listed.memories));
  check('list total is positive', listed.total > 0);
  check('list respects limit', listed.memories.length <= 5);
  const page2 = dbList(db, { repo: 'app', limit: 5, offset: 5 });
  check('list pagination offset works', page2.offset === undefined || listed.memories[0]?.id !== page2.memories[0]?.id);
  const allRepos = dbList(db, { limit: 100 });
  check('list without repo returns all projects', allRepos.total >= listed.total);

  // export / import
  const exported = dbExport(db, 'app');
  check('export returns array', Array.isArray(exported) && exported.length > 0);
  check('export includes content field', exported.every((m) => typeof m.content === 'string'));

  // import merge: insert into a fresh repo
  const mergeResult = dbImport(db, exported.map((m) => ({ ...m, repo: 'app-copy' })), 'merge');
  check('import merge inserts records', mergeResult.inserted === exported.length && mergeResult.deleted === 0);
  check('import merge records are queryable', dbList(db, { repo: 'app-copy' }).total === exported.length);

  // import replace: wipe app-copy and re-import a single record
  const replaceResult = dbImport(db, [{ repo: 'app-copy', type: 'note', content: 'replacement', tags: [], archived: false }], 'replace', 'app-copy');
  check('import replace deletes then inserts', replaceResult.deleted === exported.length && replaceResult.inserted === 1);
  check('import replace leaves only new record', dbList(db, { repo: 'app-copy' }).total === 1);

  // delete
  check('delete returns true', dbDelete(db, b.id) === true);
  check('deleted note gone from recall', !dbRecall(db, { query: 'deploy', repo: 'app' }).some((m) => m.id === b.id));
  check('delete of missing id returns false', dbDelete(db, 99999) === false);

  db.close();
} catch (err) {
  failures++;
  console.error('  FAIL threw:', err);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
