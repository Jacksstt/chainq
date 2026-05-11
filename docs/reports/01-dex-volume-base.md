---
title: DEX volume on Base — January 2026
generated_by: claude-sonnet-4.6 via chainq MCP
prompt: |
  Using chainq, characterise DEX activity on Base in January 2026.
  Break it down by protocol. Save a chart, then write the report.
chainq_tools_used:
  - chainq_list_tables
  - chainq_describe
  - chainq_metric (dex_volume_usd, dex_protocol_share)
  - chainq_chart_render
  - chainq_report
data_window: 2026-01-01 → 2026-01-31
---

# DEX volume on Base — January 2026

## Summary

Base saw **$2.41 B** of DEX volume in January 2026 across the five
aggregators captured in `dex.trades`. Uniswap V3 cleared the bulk of it;
Curve and Balancer rounded out the long tail. Daily volume was roughly
flat after the first week.

## Top protocols (by USD volume share)

| dex_name      | volume_usd      | share |
|---------------|-----------------|-------|
| uniswap_v3    | $1,612,300,000  | 0.669 |
| sushiswap     |   $401,200,000  | 0.166 |
| curve         |   $233,900,000  | 0.097 |
| uniswap_v2    |    $98,400,000  | 0.041 |
| balancer      |    $64,800,000  | 0.027 |

Source: `chainq_metric(dex_protocol_share, filters={chain: "base"}, start=…, end=…)`.

## Daily volume

![Daily DEX volume on Base, Jan 2026](./assets/01-base-daily-volume.svg)

(Generated via `chainq_chart_render(type="bar", x="day", y="volume_usd")`.)

## Notes

- The numbers above are illustrative — they come from `pnpm seed`'s
  synthetic dataset, not live mainnet. Replace with `chainq pull --chain base`
  output to reproduce against real data.
- `amount_usd` can be NULL when the pricing oracle had no data at trade
  time; the metric drops NULL rows from the aggregate. Cross-check with
  `dex_trade_count` to confirm whether thin volume reflects real inactivity
  or oracle gaps.

## Reproducing this report

```text
1. chainq_describe(table="dex.trades")
2. chainq_metric(metric="dex_volume_usd",
                 dimensions=["day"],
                 filters={chain: "base"},
                 start="2026-01-01T00:00:00Z", end="2026-02-01T00:00:00Z")
3. chainq_metric(metric="dex_protocol_share",
                 filters={chain: "base"},
                 start="2026-01-01T00:00:00Z", end="2026-02-01T00:00:00Z")
4. chainq_chart_render(type="bar", data=…, x="day", y="volume_usd",
                       filename="01-base-daily-volume.svg")
5. chainq_report(title=…, filename="01-dex-volume-base.md", sections=…)
```
