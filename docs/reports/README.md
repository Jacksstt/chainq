# Sample reports gallery

These are example reports an AI agent might produce using chainq's MCP
surface. Each report was generated against the seeded sample dataset
(`pnpm seed`) — figures are illustrative, not real onchain numbers.

Use them as:

- **Spec for evaluators**: this is the shape of output we want agents to converge on.
- **Sanity check**: when you wire chainq into a new MCP client, ask the agent to reproduce one of these.
- **Prompt-engineering reference**: each report header includes the rough prompt that produced it.

| # | Report                                                  | Formats                              | Depth | Tools touched |
|---|---------------------------------------------------------|--------------------------------------|-------|---------------|
| 1 | DEX volume on Base — Jan 2026                           | [HTML](./01-dex-volume-base.html) · [MD](./01-dex-volume-base.md) | basic | `list_tables`, `describe`, `metric`, `chart_render`, `report` |
| 2 | [Filecoin storage-provider concentration](./02-filecoin-concentration.html) (bilingual) · [MD legacy](./02-filecoin-concentration.md) | HTML + MD | **analyst-grade** (13 sections, 5 charts) | `describe`, `metric`, `query`, `concentration`, `distribution`, `histogram`, `bucketize`, `chart_render`, `report` |
| 3 | [Whuffie score distribution](./03-whuffie-distribution.md) | MD only | basic | `list_metrics`, `metric`, `chart_render`, `report` |
| 4 | [Base DEX taker concentration](./04-dex-taker-concentration.html) (bilingual) | HTML | minimal (~100 LOC source) | `query`, `concentration`, `chart_render`, `report` |
| 5 | [**Base mainnet live snapshot**](./05-base-live.html) (bilingual) | HTML | **real Base data** | `pull`, `query`, `concentration`, `chart_render`, `report` |
| 6 | [**Filecoin live concentration**](./06-filecoin-live.html) (bilingual) | HTML | **real Filecoin data** | `@chainq/ingest-filecoin fetchRecentDeals`, `concentration`, `bucketize`, `chart_render`, `report` |
| 7 | [**Multi-chain live snapshot**](./07-multichain-live.html) (bilingual) | HTML | **real data across 8 EVM chains** | 8× parallel `pull`, multi-chain DuckDB analytics, `chart_render`, `report` |
| 8 | [**Base — dbt-on-real-data snapshot**](./08-base-dbt-real.html) (bilingual) · [MD](./08-base-dbt-real.md) | HTML + MD | **real Base data, via dbt views** (rubric 100/100) | keyless RPC `pull`, `dbt run --select live`, `concentration`, `anomalyCallout`/`comparison`/`actionItem`, `chart_render`, `report`, `score_report` |

Reports 5, 6, 7, and 8 are the live-data exemplars — pulled from public
sources with no API keys (Subsquid for EVM where a key exists, otherwise a
keyless public RPC; Filfox for Filecoin). Report 7 demonstrates the
45-chain breadth (8 EVM chains in parallel); **report 8 is the
dbt-backed exemplar** — every figure is read from a `dbt` spellbook view
built over real logs, not from the raw Parquet, and it is scored by
chainq's own writing rubric. See
[docs/LIVE-INGEST-PROOF.md](../LIVE-INGEST-PROOF.md) for the
protocol-level evidence runs.

The default `chainq_report` output is now **HTML** (single-file, inline
CSS, dark/light auto, print-friendly). Pass `format: "markdown"` or use a
`.md` filename if you want Markdown. Provenance notes live in each
report's frontmatter / metadata block.
