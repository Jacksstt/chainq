# Example: investigate a Filecoin project with an AI agent

This example walks through what a `chainq`-equipped agent does when you ask it to investigate
a Filecoin project (e.g. Storacha). It is aspirational — most of these tools are still stubs.

## You say (in Claude Code)

> Investigate Storacha. I want to know who their largest clients are, deal volume over the last 90 days, and how their storage providers compare to the network. Save a report to my vault.

## What the agent does

1. `onchain_search("storacha")` → finds `filecoin.deals`, `filecoin.miners`, `tokens.fvm.erc20`.
2. `onchain_describe("filecoin.deals")` → schema + sample rows + gotchas (e.g. "epoch ≠ unix time").
3. `exa_search("Storacha Filecoin")` → public-info pass (founders, fundraising, docs).
4. `onchain_estimate_cost(...)` → confirms a 90-day query is affordable.
5. `onchain_metric("filecoin_deal_volume_bytes", project="storacha", last="90d")` → time series.
6. `onchain_query(...)` for a top-clients aggregation.
7. `chart_render("line", ...)` × 4 — deals over time, top clients, SP distribution, etc.
8. `report({project: "storacha", sections: [...], charts: [...]})` → writes Markdown + HTML to
   `~/Documents/PrimeBeat-Vault/60-Research/storacha/`.

## You get

```
~/Documents/PrimeBeat-Vault/60-Research/storacha/
  summary.md
  onchain-analysis.md
  charts/
    deal_volume_90d.png
    top_clients.png
    sp_distribution.png
  report.html
```

Total wall time: about 30 minutes. Marginal cost: about $0–$2 in API calls.
