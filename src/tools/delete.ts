import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryDb } from '../db.js';
import { dbDelete } from '../db.js';

export function registerDelete(server: McpServer, db: MemoryDb): void {
  server.registerTool(
    'memory_delete',
    {
      title: 'Delete a memory',
      description: 'Permanently remove a memory by ID. This cannot be undone.',
      inputSchema: {
        id: z.number().int().min(1).describe('ID of the memory to delete.'),
      },
    },
    async (args) => {
      const deleted = dbDelete(db, args.id);
      if (!deleted) {
        return {
          content: [
            { type: 'text' as const, text: `No memory found with id #${args.id}.` },
          ],
        };
      }
      return {
        content: [
          { type: 'text' as const, text: `Deleted memory #${args.id}.` },
        ],
      };
    },
  );
}
