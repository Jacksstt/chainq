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
- [x] Keyless ingest survives Subsquid's 2026 API-key change — `pull` auto-falls-back to public RPC (`eth_getLogs`, adaptive window, endpoint failover); `SQD_API_KEY` re-enables the archive path
- [x] dbt `live` models build on **real** Base data (run PASS=5 / test PASS=17), not just synthetic seed
- [x] Internal dogfooding: due-diligence-style snapshot generated end-to-end off the dbt views — [docs/reports/08-base-dbt-real.html](reports/08-base-dbt-real.html) (rubric 100/100). Tying it to a specific named client engagement remains a business step.

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
- [x] Yellowstone gRPC realtime stream — `streamYellowstone` (injectable transport) + `chainq watch --chain solana` writing Parquet shards with slot checkpointing; offline smoke test (`pnpm test:solana`). Real run needs a Triton/Helius gRPC endpoint + the optional `@triton-one/yellowstone-grpc` peer dep.

## v0.4.0 — Curated tables from real logs + decode registry

- [x] `event_signatures` decode registry as a dbt seed (single source of truth; `base_logs_decoded` refactored to JOIN it, topic0 unique)
- [x] Chain-agnostic `evm_raw_logs` (globs every `*.logs.parquet`, multi-chain by construction)
- [x] Live-derived curated models over real logs: `evm_erc20_transfers`, `evm_erc721_transfers` (split by the topic3 discriminator — exhaustive: erc20+erc721 == all Transfer logs), `evm_dex_trades` (UniV2/V3 swaps via the registry)
- [x] dbt seed wired into `pnpm dbt:run`; 27 models / 59 tests PASS; verified on real Base data (UniV2_Swap 526 / UniV3_Swap 434 / 277 ERC-20 tokens / 24 NFT collections)
- [ ] Full per-DEX uint256 amount decoding (needs a UDF — uint256 > DuckDB HUGEINT) — follow-up

## v0.5.0 — Scale

- [x] Iceberg storage format option — DuckDB `iceberg` extension read path: `iceberg_source()` dbt macro + `icebergScanSql()` / `loadIcebergExtension()` in `@chainq/snapshot` (read-only; write/maintenance out of scope)
- [x] Trino / Starburst backend driver — `TrinoEngine` implements the REST statement/nextUri protocol (mock-tested across pages; gated on a live coordinator for integration)
- [x] ClickHouse backend driver — `ClickHouseEngine` implements the HTTP `FORMAT JSON` interface (auth headers, row cap, stats); mock-tested
- [x] Multi-machine ingest — `chainq ingest plan` (split a range across K workers into plan files) + `chainq ingest merge` (merge worker Parquet shards); `splitRangePlan`/`mergeShards` with offline tests

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
