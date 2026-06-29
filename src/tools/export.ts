import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryDb } from '../db.js';
import { dbExport } from '../db.js';

export function registerExport(server: McpServer, db: MemoryDb): void {
  server.registerTool(
    'memory_export',
    {
      title: 'Export memories to JSON',
      description:
        'Export all memories (or a single repo) as a JSON string. ' +
        'Use this to back up memories or move them to another machine.',
      inputSchema: {
        repo: z
          .string()
          .max(128)
          .optional()
          .describe("Export only this repo's memories. Omit to export everything."),
      },
    },
    async (args) => {
      const memories = dbExport(db, args.repo);
      const json = JSON.stringify(memories, null, 2);
      const scope = args.repo ? `repo "${args.repo}"` : 'all projects';
      return {
        content: [
          {
            type: 'text' as const,
            text: `Exported ${memories.length} memories (${scope}):\n\n${json}`,
          },
        ],
      };
    },
  );
}
