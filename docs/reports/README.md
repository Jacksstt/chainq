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

Report 5 is the live-data exemplar — pulled at build time from the
public Subsquid archive (no API key, no RPC), 50 blocks of real Base
mainnet activity. See [docs/LIVE-INGEST-PROOF.md](../LIVE-INGEST-PROOF.md)
for the protocol-level evidence run.

The default `chainq_report` output is now **HTML** (single-file, inline
CSS, dark/light auto, print-friendly). Pass `format: "markdown"` or use a
`.md` filename if you want Markdown. Provenance notes live in each
report's frontmatter / metadata block.
