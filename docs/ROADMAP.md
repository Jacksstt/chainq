# Roadmap

> Living document. Updated as scope changes. Pre-`v0.1.0` everything is breakable.

## v0.0.x — Skeleton (current)

- [x] Monorepo (pnpm workspaces)
- [x] License, README, contributing guide
- [x] Architecture docs, initial ADRs
- [x] `@chainq/core` types
- [x] `@chainq/mcp-server` with full tool surface (14 tools)
- [x] `@chainq/cli` (`chainq help`, `chainq mcp serve`, `chainq seed`, `chainq pull`, `chainq init`)
- [x] `@chainq/ingest-evm` smoke test against Base
- [x] CI on push (typecheck + test)

## v0.1.0 — Minimum useful tool

**Target: 4 weeks from skeleton.**

- [x] Ingest pipelines for Ethereum, Base, Filecoin (native + FVM)
- [x] dbt-duckdb pipeline running 5+ spellbook models
- [x] MCP tools: `search_tables`, `describe`, `query`, `metric`, `estimate_cost`, `chart_render`, `report`
- [x] 10 semantic metrics
- [x] `chainq init` + `chainq pull` + `chainq mcp serve` flow works end-to-end
- [x] `chainq ingest backfill` multi-chain orchestrator
- [ ] Internal Prime Beat dogfooding on at least one live consulting case

## v0.2.0 — Quality of life

- [x] Result caching with vector recall (`recall` tool)
- [x] Cost governor: per-session hard budget (`chainq_budget_set/status/clear`)
- [x] `report` writes to Obsidian-compatible Markdown with frontmatter
- [x] Better `describe` output (table lineage, sample queries, partitions, gotchas)
- [x] `chart_render` with multiple formats (SVG / HTML / vega-lite JSON)
- [x] BM25-ranked recall over the session cache

## v0.3.0 — Solana

- [x] Solana ingest skeleton (`@chainq/ingest-solana` — Helius RPC client)
- [x] Spellbook-style curated Solana tables: `solana.transfers`, `solana.dex.trades`
- [x] First non-EVM metric set (`solana_transfer_count`, `solana_dex_volume_usd`)
- [ ] Yellowstone gRPC realtime stream

## v0.5.0 — Scale

- [ ] Iceberg storage format option
- [ ] Trino / Starburst backend driver
- [x] ClickHouse backend driver scaffold (`@chainq/engine-clickhouse`, impl pending)
- [ ] Multi-machine ingest

## v1.0.0 — Public OSS launch

- [ ] Production-ready stability
- [x] Documented setup on Linux (`docs/INSTALL_LINUX.md`) + macOS
- [x] Sample reports gallery (`docs/reports/`)
- [x] Public landing page (`docs/site/index.html`)
- [x] Structured error codes (`@chainq/core` `ChainqError` + `ChainqErrorCode`)
- [x] CI matrix: Node 20 / 22 × Ubuntu / macOS
- [ ] HN / X launch

## Beyond v1

- Pluggable label providers (mimic Nansen's labels with OSS sources)
- Reputation / Sybil data product (the Whuffie line, separate repo, depends on chainq)
- Move-chain support
- WASM-based DuckDB extensions for in-browser local query (long-term)
