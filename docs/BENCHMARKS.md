# chainq benchmarks

Generated 2026-05-11T14:56:11.921Z · Node v23.7.0 · DuckDB engine in-memory over local Parquet

Dataset: 103.6 MiB across 7 Parquet files (`./data`). Trials per query: 5.

Reproduce: `pnpm exec tsx scripts/benchmark.ts --trials 5`. For a ~100× larger dataset run `CHAINQ_SEED_SCALE=large pnpm seed` first.

| query | rows | P50 (ms) | P95 (ms) | P99 (ms) | min | max | what |
|-------|-----:|---------:|---------:|---------:|----:|----:|------|
| `p0_count` | 1 | 0.5 | 0.6 | 0.6 | 0.5 | 0.8 | Trivial COUNT over dex.trades |
| `p1_volume_by_chain` | 5 | 4.1 | 5.1 | 5.1 | 3.7 | 5.2 | GROUP BY chain SUM(amount_usd) — narrow scan |
| `p2_volume_by_day_dex` | 200 | 12.7 | 13.0 | 13.0 | 12.5 | 14.7 | GROUP BY (chain, dex_name, day) — wider grouping |
| `p3_distinct_traders` | 5 | 34.7 | 35.7 | 35.7 | 32.8 | 36.6 | COUNT(DISTINCT taker) — hash distinct on 100k+ rows |
| `p4_top_tokens_erc20` | 20 | 3.3 | 3.5 | 3.5 | 3.2 | 3.5 | Top 20 ERC-20 tokens by transfer count |
| `p5_priced_join` | 1 | 17.8 | 17.9 | 17.9 | 17.4 | 18.2 | dex.trades JOIN prices.usd on (chain, token_out, day) — cross-table |
| `p6_label_join` | 8 | 21.9 | 22.8 | 22.8 | 20.2 | 31.2 | erc20.transfers JOIN labels.addresses on recipient — label filter |
| `p7_filecoin_provider` | 25 | 2.7 | 2.8 | 2.8 | 2.5 | 3.2 | Filecoin SUM(piece_size_bytes) GROUP BY provider — top 25 |
| `p8_solana_distinct_mints` | 3 | 10.0 | 10.2 | 10.2 | 9.5 | 10.4 | Solana DISTINCT mints per day |
| `p9_window_function` | 100 | 10.5 | 11.0 | 11.0 | 10.2 | 13.2 | Window function — running USD volume on dex.trades top 5k |

## Notes

- Synthetic data from `pnpm seed`. Real-mainnet latencies will diverge — primary use is regression tracking + cost-model calibration.
- The cache DB used for `chainq_recall` is a tmp file, isolated from any running MCP server.
- Warm-up pass excluded from samples; DuckDB JIT and OS page cache effects are minimised but not eliminated.
- Window function (`p9_window_function`) is intentionally bounded to 5,000 rows to keep latency comparable across machines.
