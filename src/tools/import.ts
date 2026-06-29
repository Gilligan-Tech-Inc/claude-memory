import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryDb } from '../db.js';
import { dbImport } from '../db.js';

const MemoryRecordSchema = z.object({
  repo: z.string().default(''),
  type: z.string().default('note'),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  archived: z.boolean().default(false),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export function registerImport(server: McpServer, db: MemoryDb): void {
  server.registerTool(
    'memory_import',
    {
      title: 'Import memories from JSON',
      description:
        'Import memories from a JSON array (produced by memory_export). ' +
        'mode="merge" adds records alongside existing ones. ' +
        'mode="replace" deletes existing memories in scope first, then inserts.',
      inputSchema: {
        json: z.string().min(2).describe('JSON array of memory objects from memory_export.'),
        mode: z
          .enum(['merge', 'replace'])
          .default('merge')
          .describe('"merge" to add alongside existing; "replace" to wipe scope first.'),
        repo: z
          .string()
          .max(128)
          .optional()
          .describe('When mode="replace", only delete memories for this repo. Omit to wipe all.'),
      },
    },
    async (args) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(args.json);
      } catch {
        return {
          content: [{ type: 'text' as const, text: 'Invalid JSON: could not parse input.' }],
        };
      }

      if (!Array.isArray(parsed)) {
        return {
          content: [{ type: 'text' as const, text: 'Invalid input: expected a JSON array.' }],
        };
      }

      const records: Array<z.infer<typeof MemoryRecordSchema>> = [];
      const errors: string[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const result = MemoryRecordSchema.safeParse(parsed[i]);
        if (result.success) {
          records.push(result.data);
        } else {
          errors.push(`item[${i}]: ${result.error.issues[0]?.message ?? 'invalid'}`);
        }
      }

      if (errors.length > 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Import failed — ${errors.length} invalid record(s):\n${errors.slice(0, 5).join('\n')}`,
            },
          ],
        };
      }

      const { inserted, deleted } = dbImport(db, records, args.mode, args.repo);
      const parts: string[] = [`Imported ${inserted} memories.`];
      if (deleted > 0) parts.push(`Deleted ${deleted} existing memories (replace mode).`);

      return {
        content: [{ type: 'text' as const, text: parts.join(' ') }],
      };
    },
  );
}
