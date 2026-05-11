# Architecture

This document explains how `chainq` is structured, why each component was chosen, and what the alternatives were. For specific decisions see [`adr/`](adr/).

## Design principles

1. **Agent-first interface.** The default consumer is an LLM agent, not a human. Schemas are self-describing, errors are structured, costs are predictable.
2. **Single-node by default.** A laptop or a Mac mini should be able to run the whole stack for a small team. Distributed deployment is optional.
3. **Open formats.** Parquet on disk, dbt for transforms, MCP for the agent surface. No proprietary state.
4. **People scale matters more than data scale.** The stack is sized for teams of 1–10 engineers, not 100. Talent-supply scoring weighs into every component choice.
5. **Replace components, don't fork them.** Anything we depend on should be swappable (engine, ingester, storage format).

## Five layers

```
L5 Agent Surface     ── MCP server, CLI
L4 Semantic Layer    ── YAML metric definitions
L3 Query Engine      ── DuckDB (default), Trino / ClickHouse (optional)
L2 Transformation    ── dbt + Spellbook fork
L1 Storage           ── Parquet on fs / S3 (Iceberg in Phase 2)
L0 Ingest            ── cryo / Subsquid / Helius / Filfox
```

### L0 — Ingest

| Source | Tool | Why |
|---|---|---|
| EVM backfill | [`cryo`](https://github.com/paradigmxyz/cryo) | One Rust binary writes Parquet directly. Fastest path to "data on disk". |
| EVM realtime | [`subsquid`](https://github.com/subsquid/squid-sdk) | TypeScript-friendly, reorg-aware, large talent supply. |
| Solana | [`helius`](https://www.helius.dev/) gRPC + Yellowstone | Standard for production Solana indexing. |
| Filecoin native | [Filfox](https://filfox.info/api), [Glif](https://api.node.glif.io/), [Spacescan](https://spacescan.io/) | No mature OSS indexer for storage deals; we wrap REST APIs. |

We do not use:
- **Substreams** (StreamingFast): faster but requires Rust + protobuf expertise we don't have. Phase 2 candidate.
- **Subgraph** (The Graph): great for app-specific events, weak for cross-contract analytical queries.
- **ethereum-etl**: legacy, slow, not maintained at the pace of newer tools.

### L1 — Storage

Default: **Parquet on local filesystem or S3**, partitioned by `chain` / `year` / `month`.

Why not Iceberg from day one? Iceberg is the right answer technically (ACID, time travel, schema evolution) but the talent supply is thin. Plain Parquet with Hive-style partitioning is enough for single-writer scenarios, and DuckDB reads it natively. The migration path to Iceberg is straightforward (same Parquet files, metadata layer added) — we'll take it in Phase 2.

### L2 — Transformation

**dbt-core + a fork of [`duneanalytics/spellbook`](https://github.com/duneanalytics/spellbook)** (MIT-licensed).

The Spellbook contains years of curated SQL for `dex.trades`, `erc20.transfers`, `nft.trades`, `tokens.erc20`, and so on. Forking it gives us a multi-year head start. We adapt the dbt profile to `dbt-duckdb` instead of `dbt-trino`, then add chainq-specific subprojects for Filecoin, DePIN tables, and any consultancy-specific layers.

### L3 — Query Engine

**Primary: DuckDB.** Secondary: ClickHouse for hot pre-aggregated metrics. Trino is intentionally avoided in v0.x.

Rationale documented in [`adr/0002-query-engine-duckdb.md`](adr/0002-query-engine-duckdb.md).

### L4 — Semantic Layer

A `metrics/` directory of YAML files defines named metrics with dimensions, filters, and SQL templates. The agent reads these directly (YAML is LLM-native) instead of writing raw SQL.

Example:

```yaml
# metrics/dex_volume_usd.yml
metric: dex_volume_usd
description: DEX swap volume in USD across aggregators
dimensions: [chain, dex_name, token_pair, day]
sql_template: |
  SELECT SUM(amount_usd) AS volume_usd
  FROM dex.trades
  WHERE block_time BETWEEN {{start}} AND {{end}}
  GROUP BY {{dimensions}}
guardrails:
  max_range_days: 90
  est_cost: scan(rows) * 0.01
```

We may migrate to [Cube.dev](https://cube.dev/) once we exceed ~30 metrics.

### L5 — Agent Surface (MCP)

A TypeScript MCP server exposes a fixed set of tools:

| Tool | Purpose |
|---|---|
| `search_tables` | NL → relevant tables |
| `describe` | Full schema + sample rows + common patterns + gotchas |
| `list_metrics` | All semantic-layer metrics |
| `estimate_cost` | Row-scan estimate from `EXPLAIN` |
| `query` | Execute SQL with row / time / budget caps |
| `metric` | Execute a named metric |
| `recall` | Vector search over past query results |
| `chart_render` | Save a PNG / SVG chart from a result set |
| `report` | Write a Markdown / HTML report into a vault directory |

Why TypeScript? Largest talent supply, official MCP SDK, fits Claude Code ecosystem. The MCP server is a thin shim over DuckDB and dbt; performance is bounded by the engine, not the surface.

## What we explicitly don't build

- Multi-tenant billing
- Public dashboards
- A web SQL editor
- Token / Web3 SSO
- A wallet (out of scope; this is an analytics tool)

## What we do build but defer

- Iceberg storage format → Phase 2
- Trino backend → Phase 2 (when single-node DuckDB is no longer enough)
- Solana ingest → v0.3
- Move-chain (Sui / Aptos) → v0.5+
- Reputation / Sybil data products (the Whuffie line) → separate package

## Reference reading

- [Dune SQL blog post](https://dune.com/blog/introducing-dune-sql)
- [Dune Spellbook](https://github.com/duneanalytics/spellbook)
- [DuckDB benchmarks](https://benchmark.clickhouse.com/)
- [MCP specification](https://modelcontextprotocol.io/)
- [Paradigm cryo](https://github.com/paradigmxyz/cryo)
