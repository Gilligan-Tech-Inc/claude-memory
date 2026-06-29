import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryDb } from '../db.js';
import { dbBootstrap } from '../db.js';
import type { Memory } from '../types.js';

export function registerBootstrap(server: McpServer, db: MemoryDb): void {
  server.registerTool(
    'memory_bootstrap',
    {
      title: 'Bootstrap project memory',
      description:
        'Load all saved memories for a project at the start of a session. ' +
        'Returns repo-specific notes AND global notes (repo = ""). ' +
        'Call this once at session start with the current project slug.',
      inputSchema: {
        repo: z
          .string()
          .max(128)
          .describe(
            "Project slug (e.g. 'my-app'). Matches memories saved with this repo value.",
          ),
      },
    },
    async (args) => {
      const { repo_notes, global_notes } = dbBootstrap(db, args.repo);
      const total = repo_notes.length + global_notes.length;

      if (total === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `No memories found for repo "${args.repo}". ` +
                `Use memory_save to start building your project memory.`,
            },
          ],
        };
      }

      const fmt = (notes: Memory[]): string =>
        notes
          .map((m) => `  [#${m.id}] (${m.type}) ${m.content}`)
          .join('\n');

      const lines: string[] = [];
      if (repo_notes.length > 0) {
        lines.push(`## Project memories — ${args.repo}\n${fmt(repo_notes)}`);
      }
      if (global_notes.length > 0) {
        lines.push(`## Global memories\n${fmt(global_notes)}`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n\n') }],
      };
    },
  );
}
