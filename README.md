# claude-memory

> Persistent memory for Claude Code and Claude Desktop. Runs locally — no cloud, no account, no tracking.

[![npm version](https://img.shields.io/npm/v/@gilligan-tech/claude-memory.svg)](https://www.npmjs.com/package/@gilligan-tech/claude-memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Built with TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

---

## The problem

Claude Code starts every session cold. Every decision, rule, and project fact you explained
last week is gone. You repeat yourself constantly, and the model never learns your codebase.

**claude-memory fixes that.** It gives Claude a persistent memory backed by a local SQLite
database. Save decisions, architecture notes, deployment rules, and preferences — retrieve
them in any future session with a single call.

## Install (30 seconds)

Add to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@gilligan-tech/claude-memory"]
    }
  }
}
```

Or for Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@gilligan-tech/claude-memory"]
    }
  }
}
```

Restart Claude Code / Claude Desktop. Done.

> **Faster startup:** `npm install -g @gilligan-tech/claude-memory` then use `"command": "claude-memory"` in your config.

## Usage

At the start of a session, tell Claude:

> *"Load my memory for the my-app project."*

Claude will call `memory_bootstrap("my-app")` and load all the context you've saved.

During the session, Claude will automatically call `memory_save` when you tell it something
worth remembering — or you can ask it to.

New to persistent MCP memory? Read the [Claude Memory tutorial](docs/tutorial.md).

## Tools

| Tool | Description |
|------|-------------|
| `memory_bootstrap` | Load all memories for a project at session start |
| `memory_save` | Save a note, decision, rule, or fact |
| `memory_recall` | Search by keyword — FTS5/BM25 ranking, optional tag filter, recency-weighted |
| `memory_update` | Replace an existing memory's content by ID |
| `memory_delete` | Permanently remove a memory by ID |
| `memory_archive` | Soft-hide a memory (reversible — excluded from recall/bootstrap by default) |
| `memory_stats` | Count breakdown by project and type — e.g. "42 memories · 6 projects" |
| `memory_list` | Paginated listing without a search query |
| `memory_export` | Export memories to JSON (backup or move between machines) |
| `memory_import` | Import from JSON in merge or replace mode |

### Memory types

| Type | Use for |
|------|---------|
| `rules` | Coding conventions, style preferences, constraints |
| `architecture` | System design, component relationships, patterns |
| `deploy` | Deployment steps, server configs, environment notes |
| `decision` | Why you chose X over Y |
| `preference` | Personal working preferences |
| `note` | Everything else |

`rules` and `architecture` memories surface first in `memory_bootstrap`.

## Example session

```
You: Load my memory for the api-service project.

Claude: [calls memory_bootstrap("api-service")]

## Project memories — api-service
  [#1] (rules) Always use async/await, never callbacks. ESLint config at .eslintrc.json.
  [#2] (architecture) Three-layer: routes → services → repository. No business logic in routes.
  [#3] (deploy) Deploy via ./deploy.sh to production@api.example.com. Requires VPN.
  [#4] (decision) Switched from Prisma to Drizzle in Feb 2026 — Prisma migrations were too slow.

You: Good. Note that we switched to Hono from Express today.

Claude: [calls memory_save("Switched to Hono (from Express) June 2026 — faster cold starts and smaller bundle.", type: "decision", repo: "api-service")]

Saved memory #5.
```

## Data

Memories are stored in `~/.claude-memory/memory.db` (SQLite, local only).

Override the path: `CLAUDE_MEMORY_DB=/path/to/memory.db claude-memory`

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `CLAUDE_MEMORY_DB` | `~/.claude-memory/memory.db` | Path to the SQLite database |

## Requirements

- Node.js 22 or 24 (uses [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — ships prebuilt binaries for these versions on all major platforms, so no compiler is needed)
- No cloud account, no API key, no signup

## Built by

[Gilligan Tech Inc.](https://gilligantechinc.com) · [memory.gilligantechinc.com](https://memory.gilligantechinc.com)

Same team behind [Briefblip](https://briefblip.com) — AI meeting intelligence.

Found a bug or have a feature idea? [Open an issue](https://github.com/Gilligan-Tech-Inc/claude-memory/issues).

## License

[MIT](LICENSE)
