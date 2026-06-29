import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryDb } from '../db.js';
import { dbArchive } from '../db.js';

export function registerArchive(server: McpServer, db: MemoryDb): void {
  server.registerTool(
    'memory_archive',
    {
      title: 'Archive or unarchive a memory',
      description:
        'Toggle the archived flag on a memory. Archived memories are hidden from ' +
        'memory_recall and memory_bootstrap by default but are not deleted. ' +
        'Pass archived=false to restore a previously archived memory.',
      inputSchema: {
        id: z.number().int().min(1).describe('ID of the memory to archive or unarchive.'),
        archived: z
          .boolean()
          .optional()
          .describe('true to archive (default), false to unarchive.'),
      },
    },
    async (args) => {
      const archived = args.archived ?? true;
      const result = dbArchive(db, args.id, archived);
      if (!result) {
        return {
          content: [
            { type: 'text' as const, text: `No memory found with id #${args.id}.` },
          ],
        };
      }
      const action = result.archived ? 'Archived' : 'Unarchived';
      return {
        content: [
          { type: 'text' as const, text: `${action} memory #${result.id}.` },
        ],
      };
    },
  );
}
