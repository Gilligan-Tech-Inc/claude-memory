import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryDb } from '../db.js';
import { dbSave } from '../db.js';
import { MEMORY_TYPES } from '../types.js';

export function registerSave(server: McpServer, db: MemoryDb): void {
  server.registerTool(
    'memory_save',
    {
      title: 'Save a memory',
      description:
        'Persist a note, fact, decision, or project rule across Claude Code sessions. ' +
        "Use type='rules' or 'architecture' for context that should always load at session start.",
      inputSchema: {
        content: z
          .string()
          .min(1)
          .max(10000)
          .describe('The note, decision, or fact to remember.'),
        type: z
          .enum(MEMORY_TYPES)
          .default('note')
          .describe(
            "Category: 'rules' = coding conventions, 'architecture' = system design, " +
              "'deploy' = deployment steps, 'decision' = why X was chosen, " +
              "'preference' = personal style, 'note' = everything else.",
          ),
        repo: z
          .string()
          .max(128)
          .default('')
          .describe(
            "Project slug to scope this memory (e.g. 'my-app'). " +
              "Leave empty ('') for global memories that appear in every project.",
          ),
        tags: z
          .array(z.string().max(64))
          .max(20)
          .default([])
          .describe('Optional free-form tags for filtering (e.g. ["auth", "breaking-change"]).'),
      },
    },
    async (args) => {
      const mem = dbSave(db, args);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Saved memory #${mem.id} (type: ${mem.type}, repo: "${mem.repo || 'global'}", created: ${mem.created_at.slice(0, 10)})`,
          },
        ],
      };
    },
  );
}
