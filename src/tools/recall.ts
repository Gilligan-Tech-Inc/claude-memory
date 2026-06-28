import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DatabaseSync } from 'node:sqlite';
import { dbRecall } from '../db.js';

export function registerRecall(server: McpServer, db: DatabaseSync): void {
  server.registerTool(
    'memory_recall',
    {
      title: 'Recall memories',
      description:
        'Search saved memories by keyword using full-text search. ' +
        'Returns ranked results — best matches first.',
      inputSchema: {
        query: z.string().min(1).max(1000).describe('Keywords or phrase to search for.'),
        repo: z
          .string()
          .max(128)
          .optional()
          .describe(
            "Filter to this project's memories plus global ones. Omit to search all memories.",
          ),
        type: z
          .string()
          .max(32)
          .optional()
          .describe('Filter by memory type (e.g. "decision", "rules", "deploy").'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Maximum number of results to return.'),
      },
    },
    async (args) => {
      const results = dbRecall(db, args);
      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No memories found for "${args.query}".`,
            },
          ],
        };
      }
      const text = results
        .map(
          (m, i) =>
            `[${i + 1}] #${m.id} · ${m.type} · repo: "${m.repo || 'global'}" · updated: ${m.updated_at.slice(0, 10)}\n${m.content}`,
        )
        .join('\n\n');
      return {
        content: [{ type: 'text' as const, text }],
      };
    },
  );
}
