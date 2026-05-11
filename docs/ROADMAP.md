# Roadmap

> Living document. Updated as scope changes. Pre-`v0.1.0` everything is breakable.

## v0.0.x — Skeleton (current)

- [x] Monorepo (pnpm workspaces)
- [x] License, README, contributing guide
- [x] Architecture docs, initial ADRs
- [ ] `@chainq/core` types
- [ ] `@chainq/mcp-server` stub with one tool (`describe`)
- [ ] `@chainq/cli` stub (`chainq help`, `chainq mcp serve`)
- [ ] `@chainq/ingest-evm` smoke test against Base
- [ ] CI on push (typecheck + test)

## v0.1.0 — Minimum useful tool

**Target: 4 weeks from skeleton.**

- [ ] Ingest pipelines for Ethereum, Base, Filecoin (native + FVM)
- [ ] dbt-duckdb pipeline running 5 spellbook models
- [ ] MCP tools: `search_tables`, `describe`, `query`, `metric`, `estimate_cost`, `chart_render`, `report`
- [ ] 10 semantic metrics
- [ ] `chainq init` + `chainq ingest backfill` + `chainq mcp serve` flow works end-to-end
- [ ] Internal Prime Beat dogfooding on at least one live consulting case

## v0.2.0 — Quality of life

- [ ] Result caching with vector recall (`recall` tool)
- [ ] Cost governor: per-task hard budget for an agent session
- [ ] `chart_render` with multiple backends (matplotlib, vega-lite)
- [ ] `report` writes to Obsidian-compatible Markdown with frontmatter
- [ ] Better `describe` output (table lineage, sample queries, gotchas)

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
