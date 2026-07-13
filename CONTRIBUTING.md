# Contributing to claude-memory

Thanks for your interest in improving claude-memory. This is a small, focused project —
a local SQLite MCP memory server for Claude Code and Claude Desktop — and we intend to keep
it that way. Contributions that make it more reliable, better documented, or easier to
install are especially welcome.

## Scope

claude-memory deliberately stays narrow: short, authoritative project memory (rules,
architecture, deploy notes, decisions, preferences) retrieved with SQLite FTS5/BM25.
Document/knowledge-base RAG belongs in its sibling,
[`@gilligantechinc/claude-memory-rag`](https://github.com/Gilligan-Tech-Inc/local-rag-mcp).
Please open an issue before starting a large feature so we can confirm it fits the scope.

## Development setup

```bash
git clone https://github.com/Gilligan-Tech-Inc/claude-memory.git
cd claude-memory
npm install
npm run build
npm test
```

Requires Node.js 22 or 24.

- `npm run build` — compile TypeScript to `dist/`
- `npm run lint` — type-check with no emit
- `npm test` — build, then run the test suite against a throwaway database
- `npm run dev` — run the server from source with `tsx`

## Pull requests

1. Fork and create a branch from `main`.
2. Make your change with tests. All new behavior needs a test.
3. Ensure `npm run build`, `npm run lint`, and `npm test` all pass.
4. Add a `CHANGELOG.md` entry under **Unreleased**.
5. Open the PR and fill in the template. CI runs on Node 22 and 24 across Linux,
   macOS, and Windows — it must be green before merge.

## Style

- TypeScript, `strict` mode, no `any` unless truly unavoidable.
- Every SQL statement is a prepared statement with bound parameters.
- Keep tools small and single-purpose; one file per tool under `src/tools/`.

## Reporting bugs

Use the issue templates. For anything security-sensitive, see [SECURITY.md](SECURITY.md)
and report privately instead of opening a public issue.

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
