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
        token_budget: z
          .number()
          .int()
          .min(100)
          .max(200000)
          .optional()
          .describe(
            'Optional approximate token budget. When set, the most important notes ' +
              '(rules and architecture first, then by recency) are kept within the budget ' +
              'and the rest are omitted. Omit for no limit.',
          ),
      },
    },
    async (args) => {
      const { repo_notes, global_notes, omitted } = dbBootstrap(db, args.repo, {
        token_budget: args.token_budget,
      });
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
      if (omitted > 0) {
        lines.push(
          `_${omitted} lower-priority ${omitted === 1 ? 'note was' : 'notes were'} omitted to fit the token budget. ` +
            `Use memory_recall or memory_list to see the rest._`,
        );
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n\n') }],
      };
    },
  );
}
