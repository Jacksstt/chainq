<div align="center">

# chainq

**Self-hosted onchain analytics, redesigned for AI agents.**

The open-source, MCP-native answer to Dune.

[![status](https://img.shields.io/badge/status-pre--alpha-orange.svg)](#status)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-blue.svg)](#requirements)

</div>

---

## What

`chainq` is a self-hosted onchain analytics stack designed from the ground up for AI agents — Claude Code, Codex, OpenClaw, and any custom LLM application that speaks the [Model Context Protocol](https://modelcontextprotocol.io/).

Where Dune is a web SQL editor optimized for human analysts, `chainq` is an MCP server (and CLI) that lets AI agents:

- **Discover** what tables and metrics exist (`search_tables`, `describe`, `list_metrics`)
- **Estimate** a query's cost before running it (`estimate_cost`)
- **Execute** SQL or pre-defined metrics with hard budgets (`query`, `metric`)
- **Visualize** results as charts (`chart_render`)
- **Recall** past analyses so the same work isn't redone (`recall`)
- **Report** findings into Markdown / HTML automatically (`report`)

Under the hood: Apache Parquet on local disk or S3, DuckDB as the default query engine (Trino / ClickHouse pluggable), dbt for the transformation layer (Dune's Spellbook is MIT-licensed — we leverage it), and a thin TypeScript MCP surface.

## Why

Dune (2019) and Nansen (2020) were built when **humans wrote SQL**. In 2026, the primary consumer of onchain data is increasingly an **AI agent**:

- An agent needs **machine-readable schemas**, not a web autocomplete.
- An agent needs **cost estimates upfront**, not a "you ran out of credits" message after the fact.
- An agent needs **structured errors**, not HTML stack traces.
- An agent needs **persistent memory** of what it has already queried.
- A team that owns sensitive data needs **self-hosting**, not a vendor API.

Nansen shipped an excellent agent-facing CLI in 2026. We respect it. But it's closed-source, label-driven, and doesn't let you run arbitrary SQL over your own indexed data. Dune is open in spirit (Spellbook is OSS) but the engine and agent surface are proprietary.

`chainq` fills the gap: **fully OSS, self-hosted, MCP-first, SQL-open**.

## Who it's for

- **Researchers and consultancies** who need to investigate onchain projects rapidly and store evidence locally.
- **Builders** who want their dApp's data warehouse with no vendor lock-in.
- **Agentic-finance teams** who need an LLM agent to do due diligence without exfiltrating sensitive data to a third party.
- **Hobbyists** who want a Dune-grade environment on a laptop.

## Status

**Pre-alpha.** Active development. APIs will break without notice until `0.1.0`. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Quickstart

This will give you a running MCP server with synthetic sample data — enough
for Claude Code to introspect schemas and run real DuckDB queries.

```bash
git clone https://github.com/Jacksstt/chainq.git
cd chainq
pnpm install
pnpm seed              # generate sample Parquet files in ./data
pnpm test              # typecheck + smoke + MCP end-to-end test
pnpm mcp:serve         # start the MCP server over stdio
```

Wire it into Claude Code (one-time):

```bash
claude mcp add chainq -- pnpm --dir /absolute/path/to/chainq mcp:serve
```

Then in Claude Code:

> _"Use chainq. Tell me how many DEX trades happened on Base, and show me a query against `dex.trades` aggregated by hour."_

The agent will call `chainq_list_tables`, `chainq_describe`, `chainq_estimate_cost`,
and `chainq_query` in sequence and stream results back.

### What's working today (v0.0.x)

- `chainq_list_tables` — enumerate the catalog
- `chainq_search_tables` — natural-language search by name/description
- `chainq_describe` — schema, sample rows, gotchas
- `chainq_estimate_cost` — best-effort row / cost estimate
- `chainq_query` — DuckDB SQL over Parquet with row caps

### What's not yet implemented

- Real cryo / Subsquid / Filfox ingest (stubs only)
- Semantic-layer metrics
- Chart rendering, report-to-vault
- Spellbook dbt models (catalog is hand-curated for now)

See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Why not just use Dune?

Short version: if you're a human writing occasional SQL and sharing dashboards, **Dune is the right tool — pay them**. If an AI agent is doing the work, or your data is sensitive, or the chain is exotic, or your workload is heavy, you want chainq. See [`docs/COMPARISON.md`](docs/COMPARISON.md) for the full side-by-side (Dune Free vs Dune Analyst vs chainq).

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Agent / CLI surface                                              │
│   MCP tools: search, describe, query, metric, chart, report     │
├──────────────────────────────────────────────────────────────────┤
│ Semantic layer                                                   │
│   YAML metric definitions (LLM-readable) → SQL plans            │
├──────────────────────────────────────────────────────────────────┤
│ Query engine (pluggable)                                         │
│   default: DuckDB    optional: Trino, ClickHouse, DataFusion    │
├──────────────────────────────────────────────────────────────────┤
│ Transformation                                                   │
│   dbt-core + chainq-spellbook (fork of duneanalytics/spellbook) │
├──────────────────────────────────────────────────────────────────┤
│ Storage                                                          │
│   Parquet on local fs or S3 (Iceberg in Phase 2)                │
├──────────────────────────────────────────────────────────────────┤
│ Ingest                                                           │
│   EVM: cryo (Paradigm) for backfill, Subsquid for realtime      │
│   Filecoin: Filfox + Glif + Spacescan wrappers                  │
│   Solana: Helius / Yellowstone gRPC                              │
└──────────────────────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for rationale and tradeoffs.

## Packages

| Package | Purpose |
|---|---|
| [`@chainq/core`](packages/core) | Shared types, schemas, semantic-layer model |
| [`@chainq/mcp-server`](packages/mcp-server) | MCP server exposing the agent tools |
| [`@chainq/cli`](packages/cli) | Standalone CLI (wraps the MCP server) |
| [`@chainq/ingest-evm`](packages/ingest-evm) | EVM ingestion via cryo + Subsquid |
| [`@chainq/ingest-filecoin`](packages/ingest-filecoin) | Filecoin-native ingestion |
| [`spellbook/`](spellbook) | dbt project (fork of Dune Spellbook + chainq additions) |

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Headline:

- **v0.0.x** — Skeleton, MCP server stub, single-chain (Base) ingest demo
- **v0.1.0** — Multi-chain ingest (Ethereum + Base + Filecoin), 5 MCP tools, 10 curated tables
- **v0.2.0** — Semantic layer GA, chart rendering, report-to-vault
- **v0.5.0** — Iceberg support, Trino backend, Solana
- **v1.0.0** — Production-ready, public OSS launch

## Contributing

Pre-alpha — please open an issue before sending a PR so we can align. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

- [`duneanalytics/spellbook`](https://github.com/duneanalytics/spellbook) — the curated table definitions we build on (MIT)
- [`paradigmxyz/cryo`](https://github.com/paradigmxyz/cryo) — EVM data extraction
- [`subsquid/squid-sdk`](https://github.com/subsquid/squid-sdk) — realtime indexing
- [DuckDB](https://duckdb.org/) — the engine that makes single-node analytics feasible

## License

MIT — see [LICENSE](LICENSE).

Built by [Prime Beat](https://primebeat.jp).
