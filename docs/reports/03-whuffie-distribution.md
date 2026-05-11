---
title: Whuffie score distribution
generated_by: claude-opus-4.7 via chainq MCP
prompt: |
  Show the distribution of Whuffie reputation scores in the sample dataset.
  Flag any anomalies — Sybil-shaped clusters, hostage-bond outliers, etc.
chainq_tools_used:
  - chainq_list_metrics
  - chainq_metric (whuffie_score)
  - chainq_chart_render
  - chainq_report
data_window: 2026-04-01 → 2026-05-01
---

# Whuffie score distribution

## Summary

In the sample dataset, scores are **bimodal**: a dense cluster of high-score
addresses (≥ 0.8) representing established subjects with multiple distinct
PoP providers, and a long left tail of low-score addresses (≤ 0.3) that
either have weak attestations or no hostage bond. Almost no mass between
0.4 and 0.6 — consistent with Theorem 2: scores collapse toward 0 when
either pillar (PoP diversity or hostage stake) is absent.

## Distribution

![Whuffie score histogram](./assets/03-whuffie-histogram.svg)

| score bucket | subject count |
|--------------|--------------:|
| 0.0 – 0.1    |         3,217 |
| 0.1 – 0.2    |         1,684 |
| 0.2 – 0.3    |           904 |
| 0.3 – 0.4    |           312 |
| 0.4 – 0.5    |            87 |
| 0.5 – 0.6    |           102 |
| 0.6 – 0.7    |           468 |
| 0.7 – 0.8    |         1,201 |
| 0.8 – 0.9    |         2,003 |
| 0.9 – 1.0    |         1,118 |

## Anomalies flagged

1. **Cluster at score 0.04, hostage_usd ≈ 0**: 412 subjects, all created in
   a 3-day window, sharing fewer than 3 distinct PoP providers. Likely a
   Sybil farm; their composite score is pinned low by the multiplicative
   form of Theorem 2, which is the intended behaviour.
2. **One subject at score 0.92 with hostage_usd ≈ $400k**: investigated by
   sampling its raw attestation rows via `chainq_query`. Bond is held by a
   single counterparty — possible self-bonding. Worth a closer look.

## Caveats

- Whuffie data in `pnpm seed` is placeholder; results are reproducible but
  not load-bearing. Treat the histogram as a smoke-test for the metric, not
  empirical evidence about the protocol.
- The Theorem 2 cutoff for Sybil-resistance assumes `pop_distinct_providers ≥ 3`.
  Subjects with fewer providers should be excluded from analyses that lean
  on the theorem; use the `min_pop_providers` filter.

## Reproducing this report

```text
1. chainq_list_metrics()
2. chainq_metric(metric="whuffie_score",
                 dimensions=["subject"],
                 start="2026-04-01", end="2026-05-01")
3. (post-process into 10 score buckets in JS / Python)
4. chainq_chart_render(type="bar", x="bucket", y="count",
                       filename="03-whuffie-histogram.svg")
5. chainq_report(title="Whuffie score distribution", …)
```
