import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DatabaseSync } from 'node:sqlite';
import { dbUpdate } from '../db.js';

export function registerUpdate(server: McpServer, db: DatabaseSync): void {
  server.registerTool(
    'memory_update',
    {
      title: 'Update a memory',
      description:
        'Replace the content of an existing memory by ID. ' +
        'The ID comes from memory_save or memory_recall output.',
      inputSchema: {
        id: z.number().int().min(1).describe('ID of the memory to update.'),
        content: z
          .string()
          .min(1)
          .max(10000)
          .describe('New content to replace the existing note.'),
      },
    },
    async (args) => {
      const result = dbUpdate(db, args.id, args.content);
      if (!result) {
        return {
          content: [
            { type: 'text' as const, text: `No memory found with id #${args.id}.` },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated memory #${result.id} (updated_at: ${result.updated_at.slice(0, 10)})`,
          },
        ],
      };
    },
  );
}
