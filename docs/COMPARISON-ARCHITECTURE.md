# Dune vs chainq — architecture comparison

`docs/COMPARISON.md` covers **feature parity**. This file covers
**architecture**: where the data physically lives, what runs where, and
which design tradeoffs each system makes.

Written 2026-05. Dune internals reconstructed from their public engineering
blog, conference talks (DuneCon), and the open-source Spellbook repo —
exact figures may drift but the shape is right.

## TL;DR — the one-paragraph version

**Dune** is a multi-tenant SaaS: their own Spark/Trino indexer reads from
their own RPC nodes, materializes Iceberg tables on S3, and a hosted
Trino cluster serves SQL through a web UI to ~thousands of concurrent
human analysts. Pricing is credit-based on **datapoints scanned**.

**chainq** is a single-process self-hosted stack: it leeches off
**Subsquid's public archive** (or your own reth/lotus node) over HTTP,
materializes Parquet files on **your local disk**, and an in-process
**DuckDB** answers SQL through an **MCP server** to one or more AI
agents (and incidentally a human via CLI). Pricing is whatever your
laptop costs to leave running.

Each architecture is correct for its target. Dune is the right answer
when you want a hosted spreadsheet-with-SQL for the entire industry.
chainq is the right answer when an AI agent or a team with sensitive
data needs to own the stack end-to-end.

## The two stacks, side by side

### Dune (SaaS, multi-tenant)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser / API client                                                 │
│   Dune web app · REST · GraphQL · Slack alerts                       │
└────────────────────────────────────┬─────────────────────────────────┘
                                     │ HTTPS, auth + credit accounting
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Dune control plane                                                   │
│   query gateway · query queue · result cache · billing ledger        │
└────────────────────────────────────┬─────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Query engine                                                         │
│   Trino cluster (DuneSQL) — distributed coordinator + workers        │
│   Catalog: hive-style (Iceberg on S3)                                │
└────────────────────────────────────┬─────────────────────────────────┘
                                     │ reads Iceberg
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Storage (Iceberg on S3, petabyte scale)                              │
│   silver / gold curated tables  ←  dbt Spellbook materializations    │
│   raw decoded events            ←  per-chain indexer outputs         │
└────────────────────────────────────┬─────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Ingest                                                               │
│   Per-chain Spark indexers reading from Dune-operated archive /      │
│   RPC nodes. Reorg-safe, schema-versioned, monitored 24/7.           │
│                                                                      │
│   ↑ reads from                                                       │
│   reth / erigon / lotus / solana-rpc — operated by Dune              │
└──────────────────────────────────────────────────────────────────────┘
```

### chainq (self-hosted, single-tenant)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Caller surface                                                       │
│   AI agent (MCP stdio: Claude Code, Codex, Cursor, …)                │
│   Human (chainq CLI: tools / metrics / pull / watch / mcp serve)     │
│   Static report HTML (docs/reports/*, deployable to any web host)    │
└────────────────────────────────────┬─────────────────────────────────┘
                                     │ MCP / argv
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ @chainq/mcp-server                                                   │
│   18 tools · cost governor · BM25 recall · bilingual HTML reports    │
│   in-process; no network between caller and engine                   │
└────────────────────────────────────┬─────────────────────────────────┘
                                     │ in-proc TS → DuckDB
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Query engine                                                         │
│   DuckDB (single-process) · views over Parquet · `EXPLAIN` cost      │
│   Future: pluggable EngineDriver (@chainq/engine-clickhouse scaffold)│
└────────────────────────────────────┬─────────────────────────────────┘
                                     │ reads Parquet
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Storage (Parquet on YOUR disk, GB-to-TB scale)                       │
│   curated tables ← spellbook dbt-duckdb materializations             │
│   raw logs       ← chainq pull / chainq watch outputs                │
│   No multi-tenant. No vendor lock-in. Encrypt the disk if you want.  │
└────────────────────────────────────┬─────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Ingest                                                               │
│   @chainq/snapshot  → public Subsquid archive (worker discovery)     │
│   @chainq/ingest-evm → cryo CLI for backfills (optional)             │
│   @chainq/ingest-filecoin → Filfox + Spacescan public REST           │
│   @chainq/ingest-solana → Helius RPC (needs API key, free tier OK)   │
│                                                                      │
│   ↑ all are HTTP clients to OTHER PEOPLE's nodes / archives.         │
│   Optional: point at your own reth / lotus — same code path.         │
└──────────────────────────────────────────────────────────────────────┘
```

## Layer-by-layer comparison

### 1. Ingest

| | Dune | chainq |
|---|---|---|
| Who runs the indexer | Dune | Subsquid (public archive) or you |
| Where it reads from | Dune's own RPC nodes | Subsquid archive REST, optionally your RPC |
| Operational responsibility | Dune | The archive operator (or you) |
| Reorg handling | Their indexer rolls back N blocks on detect | Subsquid serves finalised blocks; `chainq watch` is head-only-to-finalised today |
| Cost to operate | Bundled in subscription | $0 against public archive; ~$50-200/mo if self-hosting reth |

The biggest single architectural difference: **Dune owns the nodes and
indexers**; **chainq doesn't**. That's the entire pricing-model split.
When you pay Dune you pay for their fleet of reth/lotus boxes + Spark
jobs + 24/7 oncall. When you run chainq you either piggyback on
Subsquid's open infrastructure or run your own node and absorb the cost
yourself.

### 2. Storage

| | Dune | chainq |
|---|---|---|
| Format | Apache Iceberg | Apache Parquet |
| Filesystem | S3 (Dune's bucket) | Local disk (your `./data/`) or S3 (planned) |
| Scale | Multi-petabyte, multi-tenant | GB-to-TB, single-tenant |
| Encryption at rest | S3 SSE | Whatever your filesystem does |
| Multi-version / time travel | Iceberg snapshots | One file per table by default; `chainq watch` writes sharded files |
| Replication | S3 cross-region | None (it's your laptop) |

Same column-store family (Parquet under both Iceberg and DuckDB),
different surface. Iceberg buys you time-travel, schema evolution
without rewrites, multi-petabyte indexing. Parquet on local disk buys
you "you can `mv` it to a USB stick and walk away."

### 3. Query engine

| | Dune | chainq |
|---|---|---|
| Engine | **Trino** (DuneSQL) — distributed | **DuckDB** — single-process |
| Concurrency model | Multi-worker cluster, queue + queue jumping | One process, one DuckDB connection (or a pool) |
| SQL dialect | Trino SQL (PostgreSQL-ish) | DuckDB SQL (PostgreSQL-ish + nicer subsets) |
| Cost model | Datapoints scanned → credits → $ | Hardware time + electricity. `estimate_cost` returns rows/bytes/sec |
| Multi-tenant isolation | Trino does it; queue tier per plan | None needed (single tenant) |
| Latency profile | Network RTT to query + scan time over PB | Process boot (sub-second) + scan time over GB |
| Performance ceiling | Petabytes-scanned-per-query (Trino is good at this) | ~1B rows on a single laptop is fine; ClickHouse driver scaffolded for hot-metric tier |

DuckDB at 10 GB and Trino at 10 GB perform similarly on most queries.
The crossover is somewhere between 100 GB and 1 TB; above that Dune's
distributed engine wins on aggregate throughput. **For most personal /
team / single-chain workloads the crossover never matters.**

### 4. Transformation (dbt)

| | Dune | chainq |
|---|---|---|
| dbt? | Yes — Spellbook | Yes — chainq fork of the Spellbook pattern |
| Target adapter | `dbt-trino` | `dbt-duckdb` |
| Owner of models | Community (Spellbook on GitHub, MIT) | Same Spellbook compatible; chainq adds its own models |
| Where it runs | Inside Dune's infra | On your machine (`pnpm dbt:run`) |
| Test gate | dbt tests run by Dune CI | dbt tests in your local CI (this repo: 42 passing) |

This is the **most architecturally similar layer**. dbt was the right
choice and both pick the same answer. The portable layer ends here:
write SQL once, run it on either backend (with minor dialect differences
between Trino and DuckDB).

### 5. Access / interface

| | Dune | chainq |
|---|---|---|
| Primary UI | Web app (React) | MCP server (stdio JSON-RPC) |
| Secondary | REST + GraphQL API | CLI: `chainq tools`, `chainq metrics`, `chainq pull`, … |
| Charts | In-app, interactive, dashboardable | Vega-lite SVG / HTML / JSON spec, embedded in HTML reports |
| Reports | Dashboards (web-only, hosted) | Single-file bilingual HTML, brand-customizable, downloadable |
| Auth | Account-based, paid plans gate features | Local — no auth needed; AI agent talks to MCP over stdio |
| Sharing | Public/private queries, dashboard URLs | Static HTML — host it on GitHub Pages, Notion, S3, anywhere |

This is the **largest cultural difference**. Dune is built around a
human pointing at a SQL editor. chainq is built around an AI agent
sending JSON-RPC tool calls over stdio. The web UI / dashboard
worldview is entirely missing from chainq, and the cost-aware / budget /
self-introspection tooling is entirely missing from Dune.

### 6. Operational model

| | Dune | chainq |
|---|---|---|
| Who's oncall | Dune ops team | You |
| Uptime SLA | Their public SLA | Whatever your `pnpm test` says |
| Updates | Pushed automatically | You `git pull && pnpm install` |
| Cost when idle | Same monthly fee | $0 (just disk) |
| Cost when running 1000 queries | $0 if within plan, $5/100 credits over | $0 (your CPU, your electricity) |
| Backup | S3 versioning + their ops | Your responsibility (`rsync data/ s3://...`) |

### 7. AI-agent affordances (where the design philosophies most diverge)

| | Dune | chainq |
|---|---|---|
| Cost estimate before running | No — the agent burns credits to find out the cost | **Yes** — `chainq_estimate_cost` returns rows/bytes/seconds |
| Per-session hard budget | No — the agent can drain the account | **Yes** — `chainq_budget_set` rejects queries that would breach |
| Persistent recall across sessions | No (queries are logged but not searchable per-agent) | **Yes** — BM25-ranked `chainq_recall` over the local cache |
| Structured error codes | HTTP statuses + free-form messages | **`ChainqError { code, message, details }`** — 11 codes |
| Schema discovery | Dune SQL `INFORMATION_SCHEMA` | **`chainq_describe`** returns lineage + sample queries + gotchas + partitions |
| Bilingual / branded reports out of the box | No (agents must reach for an LLM to write Markdown) | **Yes** — `chainq_report` with `locale: "both"` and `brand` overrides |
| First-class MCP server | No (must wrap Dune API in your own MCP) | **Yes — the MCP server IS the product** |

This is the part chainq actually beats Dune on, by design. Dune's
APIs were built for humans clicking buttons; the agent affordances are
ports of that surface. chainq's APIs were built for agents from line 1.

## Performance back-of-envelope

A specific scenario: "Daily DEX volume on Base for the last 90 days."

- **Dune Plus ($349/mo)** — DuneSQL on their cluster, the query
  scans the curated `dex.trades` partition for Base × 90 days. Real
  latency: 5-20 seconds (network + scheduling + scan). Credit cost on
  the user's account: a few hundred datapoints.
- **chainq + reth on a $100/mo Hetzner box** — same query against the
  locally materialized `dex.trades`. Real latency on a 100 GB-scale
  Parquet shard: 2-15 seconds end-to-end (DuckDB scan, no network).
  $ cost: zero marginal per query.
- **chainq on a laptop with public-archive-only data** — at the same
  scope you'd pull the data once, then re-query it locally for free
  forever. Pull time is the dominant cost (one-time, minutes).

**Where Dune wins on perf**: queries that touch 10+ chains and require
the join planner to coordinate scans across petabyte-scale partitions.
Trino's distributed engine beats single-node DuckDB at this volume.

**Where chainq wins on perf**: any single-chain workload that fits in
≤ 1 TB and runs more than a few times — local DuckDB latency is
sub-second after the first scan warms the OS page cache, while every
Dune query pays full network RTT.

## Tradeoff summary

| If you care about… | Pick |
|---|---|
| Zero ops, multi-tenant convenience, the whole catalog of public dashboards and community queries | **Dune** |
| Sub-petabyte data, predictable cost, no per-query billing, on-prem / data sovereignty | **chainq** |
| AI agent doing autonomous investigations with budget caps and structured errors | **chainq** |
| Multi-chain joins over multi-petabyte tables that exceed a single machine's RAM | **Dune** |
| Sensitive client data that can't leave your VPC | **chainq** |
| One-off public-facing dashboard you'll share on Twitter | **Dune** |
| Branded analyst-grade HTML reports embedded in client deliverables | **chainq** |
| The full Dune Spellbook of curated cross-chain tables, day-1 ready | **Dune** |
| A toolkit you can rebuild, audit, and modify yourself | **chainq** |

Neither is universally better. They are optimised for **different
buyers** (analyst / dashboard consumer vs. AI agent / sensitive-data
team) and at different **price-per-query economics** (subscription
predictable spend vs. zero marginal post-pull).

## What chainq deliberately doesn't do (because Dune does it well)

- Hosting a multi-tenant SQL editor for the internet
- Maintaining a global indexer fleet for 50+ chains
- Running a community of forkable public queries
- Selling per-seat dashboards to enterprises

If those are what you want, use Dune.

## What Dune doesn't do (where chainq fills the gap)

- Run on a single machine you control
- Talk MCP as its primary interface
- Reject queries based on a per-task budget before they execute
- Emit publishable bilingual reports directly from the engine
- Let an organisation keep onchain data inside its own firewall

If those are what you want, use chainq.

## Common code surface (both stacks)

- Apache Parquet column format
- Apache dbt for transformation
- Spellbook-style curated tables (chainq's models are MIT-compatible with Dune's Spellbook)
- DuckDB SQL is the local-dev story Dune themselves recommend for
  prototyping models before pushing to DuneSQL (same engine family)

These are the bridges. If a team starts on chainq and outgrows it,
the migration path to Dune is mostly a `dbt-trino` adapter swap. If a
team has Dune queries today, porting them to chainq is mostly running
`dbt-duckdb` against the Spellbook fork. Either direction works.
