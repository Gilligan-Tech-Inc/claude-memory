import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DatabaseSync } from 'node:sqlite';
import { registerSave } from './tools/save.js';
import { registerRecall } from './tools/recall.js';
import { registerBootstrap } from './tools/bootstrap.js';
import { registerUpdate } from './tools/update.js';
import { registerDelete } from './tools/delete.js';

export function buildServer(db: DatabaseSync): McpServer {
  const server = new McpServer(
    { name: 'claude-memory', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'claude-memory gives Claude Code persistent memory across sessions using local SQLite. ' +
        'At session start: call memory_bootstrap(repo) to load all saved context for this project. ' +
        'During the session: call memory_save to persist important decisions, rules, or facts. ' +
        'Use memory_recall to search for specific remembered information. ' +
        'Use memory_update and memory_delete to keep memories accurate over time. ' +
        "Global notes (repo='') apply to all projects. " +
        "Notes with type='rules' or 'architecture' are especially important context.",
    },
  );

  registerSave(server, db);
  registerRecall(server, db);
  registerBootstrap(server, db);
  registerUpdate(server, db);
  registerDelete(server, db);

  return server;
}
