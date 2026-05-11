# Sample reports gallery

These are example reports an AI agent might produce using chainq's MCP
surface. Each report was generated against the seeded sample dataset
(`pnpm seed`) — figures are illustrative, not real onchain numbers.

Use them as:

- **Spec for evaluators**: this is the shape of output we want agents to converge on.
- **Sanity check**: when you wire chainq into a new MCP client, ask the agent to reproduce one of these.
- **Prompt-engineering reference**: each report header includes the rough prompt that produced it.

| # | Report                                                  | Tools touched                                     |
|---|---------------------------------------------------------|---------------------------------------------------|
| 1 | [DEX volume on Base — Jan 2026](./01-dex-volume-base.md) | `list_tables`, `describe`, `metric`, `chart_render`, `report` |
| 2 | [Filecoin storage-provider concentration](./02-filecoin-concentration.md) | `describe`, `query`, `report`                     |
| 3 | [Whuffie score distribution](./03-whuffie-distribution.md) | `list_metrics`, `metric`, `chart_render`, `report` |

Generation prompts and provenance notes are in each file's frontmatter.
