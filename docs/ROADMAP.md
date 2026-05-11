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
- [ ] `chainq ingest backfill` general wrapper (today: per-chain `chainq pull`)
- [ ] Internal Prime Beat dogfooding on at least one live consulting case

## v0.2.0 — Quality of life

- [x] Result caching with vector recall (`recall` tool)
- [x] Cost governor: per-session hard budget (`chainq_budget_set/status/clear`)
- [x] `report` writes to Obsidian-compatible Markdown with frontmatter
- [x] Better `describe` output (table lineage, sample queries, partitions, gotchas)
- [ ] `chart_render` with multiple backends (matplotlib, vega-lite)
- [ ] Vector-similarity recall on top of LIKE-based recall

## v0.3.0 — Solana

- [ ] Solana ingest via Helius / Yellowstone gRPC
- [ ] Spellbook-style curated Solana tables: `solana.transfers`, `solana.dex.trades`
- [ ] First non-EVM metric set

## v0.5.0 — Scale

- [ ] Iceberg storage format option
- [ ] Trino / Starburst backend driver
- [ ] ClickHouse backend driver (for hot metrics)
- [ ] Multi-machine ingest

## v1.0.0 — Public OSS launch

- [ ] Production-ready stability
- [ ] Documented setup on Linux + macOS
- [ ] Sample reports gallery
- [ ] Public landing page
- [ ] HN / X launch

## Beyond v1

- Pluggable label providers (mimic Nansen's labels with OSS sources)
- Reputation / Sybil data product (the Whuffie line, separate repo, depends on chainq)
- Move-chain support
- WASM-based DuckDB extensions for in-browser local query (long-term)
