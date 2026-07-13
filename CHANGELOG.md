# Changelog

All notable changes to `@gilligantechinc/claude-memory` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `memory_bootstrap` now accepts an optional `token_budget`. When set, the most important
  notes (`rules`/`architecture` first, then by recency) are kept within the budget and the
  remainder are omitted with a pointer to `memory_recall` — so large stores don't blow the
  context window at session start.
- Continuous integration (GitHub Actions) building, type-checking, and testing on
  Node 22 and 24 across Linux, macOS, and Windows.
- Community health files: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  issue forms, and a pull-request template.
- Expanded test suite (`node --test`) covering recall ranking, repo/global scoping,
  FTS special-character fallback, pagination, tag AND-matching, and bootstrap budgeting.

### Changed
- `memory_recall` ranking replaced the ad-hoc `bm25 + days` blend with **Reciprocal Rank
  Fusion** of keyword relevance and recency — scale-free, with proper tie handling so a
  fresh note reliably outranks a stale one of equal relevance.
- The MCP server now reports its version from `package.json` instead of a hardcoded
  string, so it can never drift out of sync with the published package again.
- `openDb()` accepts an optional path argument (enables isolated tests).

## [0.2.2] - 2026-06-29

### Changed
- Renamed the npm package to the `@gilligantechinc` scope.

## [0.2.1] - 2026-06-29

### Changed
- Version bump; documentation and demo-site updates.

## [0.2.0] - 2026-06-29

### Added
- Migrated storage to [better-sqlite3](https://github.com/WiseLibs/better-sqlite3).
- Five additional tools: `memory_archive`, `memory_stats`, `memory_list`,
  `memory_export`, `memory_import`.
- Smoke-test suite covering the storage layer.

### Changed
- Pinned `engines.node` to `>=22` to match better-sqlite3 prebuilt-binary coverage.

## [0.1.0] - 2026-06-29

### Added
- Initial release: local SQLite MCP memory server with `memory_bootstrap`,
  `memory_save`, `memory_recall`, `memory_update`, and `memory_delete`.

[Unreleased]: https://github.com/Gilligan-Tech-Inc/claude-memory/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/Gilligan-Tech-Inc/claude-memory/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Gilligan-Tech-Inc/claude-memory/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Gilligan-Tech-Inc/claude-memory/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Gilligan-Tech-Inc/claude-memory/releases/tag/v0.1.0
