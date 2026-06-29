import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryDb } from './db.js';
import { registerSave } from './tools/save.js';
import { registerRecall } from './tools/recall.js';
import { registerBootstrap } from './tools/bootstrap.js';
import { registerUpdate } from './tools/update.js';
import { registerDelete } from './tools/delete.js';
import { registerArchive } from './tools/archive.js';
import { registerStats } from './tools/stats.js';
import { registerList } from './tools/list.js';
import { registerExport } from './tools/export.js';
import { registerImport } from './tools/import.js';

export function buildServer(db: MemoryDb): McpServer {
  const server = new McpServer(
    { name: 'claude-memory', version: '0.2.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'claude-memory gives Claude Code persistent memory across sessions using local SQLite. ' +
        'At session start: call memory_bootstrap(repo) to load all saved context for this project. ' +
        'During the session: call memory_save to persist important decisions, rules, or facts. ' +
        'Use memory_recall to search — it supports keyword search, tag filtering, and recency-weighted ranking. ' +
        'Use memory_update and memory_delete to keep memories accurate over time. ' +
        'Use memory_archive to soft-hide memories that are no longer active (reversible). ' +
        'Use memory_stats for an at-a-glance count across projects; memory_list to page through all memories without a query. ' +
        'Use memory_export / memory_import to back up or transfer memories between machines. ' +
        "Global notes (repo='') apply to all projects. " +
        "Notes with type='rules' or 'architecture' are especially important context.",
    },
  );

  registerSave(server, db);
  registerRecall(server, db);
  registerBootstrap(server, db);
  registerUpdate(server, db);
  registerDelete(server, db);
  registerArchive(server, db);
  registerStats(server, db);
  registerList(server, db);
  registerExport(server, db);
  registerImport(server, db);

  return server;
}
