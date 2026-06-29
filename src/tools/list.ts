import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryDb } from '../db.js';
import { dbList } from '../db.js';
import type { Memory } from '../types.js';

export function registerList(server: McpServer, db: MemoryDb): void {
  server.registerTool(
    'memory_list',
    {
      title: 'List memories',
      description:
        'List memories for a project without a search query. ' +
        'Use memory_recall for keyword search; use this to browse everything saved for a repo.',
      inputSchema: {
        repo: z
          .string()
          .max(128)
          .optional()
          .describe("Project slug to filter by. Omit to list all memories across every project."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Number of memories per page.'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Offset for pagination.'),
        include_archived: z
          .boolean()
          .optional()
          .describe('Include archived memories. Defaults to false.'),
      },
    },
    async (args) => {
      const { memories, total } = dbList(db, args);

      if (total === 0) {
        const scope = args.repo ? `repo "${args.repo}"` : 'any project';
        return {
          content: [
            {
              type: 'text' as const,
              text: `No memories found for ${scope}.`,
            },
          ],
        };
      }

      const from = args.offset + 1;
      const to = Math.min(args.offset + args.limit, total);
      const scope = args.repo ? `repo "${args.repo}"` : 'all projects';
      const header = `Showing ${from}–${to} of ${total} (${scope})`;

      const fmt = (m: Memory): string => {
        const tags = m.tags.length > 0 ? `  [${m.tags.join(', ')}]` : '';
        return `[#${m.id}] ${m.type} · ${m.content.slice(0, 120)}${tags}  ${m.updated_at.slice(0, 10)}`;
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: [header, '', ...memories.map(fmt)].join('\n'),
          },
        ],
      };
    },
  );
}
