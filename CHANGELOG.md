# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Pre-`v0.1.0` is breaking by default; we only call out highlights.

## [Unreleased]

### Added

- `@chainq/mcp-server` now exposes 5 working MCP tools:
  `chainq_list_tables`, `chainq_search_tables`, `chainq_describe`,
  `chainq_estimate_cost`, `chainq_query`.
- DuckDB engine that reads Parquet files from `data/` and exposes them as
  views matching the catalog names (`dex.trades`, `erc20.transfers`, `filecoin.deals`).
- Hand-curated catalog of three tables with schema, sample rows, and gotchas.
- `chainq mcp serve` CLI subcommand spawns the MCP server over stdio.
- `pnpm seed` script generates synthetic Parquet so a fresh checkout has data.
- In-process smoke test (`scripts/smoke-test.ts`) and end-to-end MCP test
  (`scripts/mcp-smoke-test.ts`); CI runs both.
- `DEVELOPMENT.md` with the contributor loop.
- `docs/COMPARISON.md` — side-by-side vs Dune Free and Analyst.

## [0.0.0] — 2026-05-11

### Added

- Initial monorepo skeleton (pnpm workspaces).
- Architecture docs, ROADMAP, 3 ADRs.
- README, CONTRIBUTING, LICENSE (MIT).
- Package stubs: `core`, `mcp-server`, `cli`, `ingest-evm`, `ingest-filecoin`, `semantic`.
- GitHub Actions CI skeleton.
