# Security Policy

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public GitHub issue for a
vulnerability.

- Preferred: open a private advisory at
  <https://github.com/Gilligan-Tech-Inc/claude-memory/security/advisories/new>.
- Or email **security@gilligantechinc.com** with details and reproduction steps.

We aim to acknowledge reports within 3 business days and to ship a fix or mitigation
for confirmed issues as quickly as is practical.

## Scope and threat model

claude-memory is a **local-first** tool. It:

- stores all data in a local SQLite database (default `~/.claude-memory/memory.db`);
- makes **no** network calls and requires no account, API key, or cloud service;
- runs as a stdio MCP subprocess launched by your MCP host (Claude Code / Claude Desktop).

Because it is local, the primary trust boundary is the machine it runs on and the MCP
host that launches it. Reports we are most interested in:

- SQL injection or FTS query handling that can read/write outside the intended rows;
- path handling around `CLAUDE_MEMORY_DB` that could write outside the intended location;
- any code path that unexpectedly performs network I/O or executes shell commands.

## Supported versions

The latest published minor version receives security fixes. Please upgrade before
reporting to confirm the issue still reproduces.
