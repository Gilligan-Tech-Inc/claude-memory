import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryDb } from '../db.js';
import { dbStats } from '../db.js';

export function registerStats(server: McpServer, db: MemoryDb): void {
  server.registerTool(
    'memory_stats',
    {
      title: 'Memory statistics',
      description:
        'Return a count of all non-archived memories grouped by project and type. ' +
        'Useful for an at-a-glance view of how much is stored across projects.',
      inputSchema: {},
    },
    async () => {
      const { total, repo_count, rows } = dbStats(db);

      if (total === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No memories saved yet. Use memory_save to get started.',
            },
          ],
        };
      }

      // Group rows by repo
      const byRepo = new Map<string, Array<{ type: string; count: number }>>();
      for (const row of rows) {
        const key = row.repo === '' ? '(global)' : row.repo;
        if (!byRepo.has(key)) byRepo.set(key, []);
        byRepo.get(key)!.push({ type: row.type, count: row.count });
      }

      const lines: string[] = [`${total} memories · ${repo_count} project${repo_count !== 1 ? 's' : ''}`, ''];
      for (const [repo, types] of byRepo) {
        const repoTotal = types.reduce((s, t) => s + t.count, 0);
        lines.push(`${repo} (${repoTotal})`);
        for (const { type, count } of types) {
          lines.push(`  ${type}: ${count}`);
        }
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );
}
