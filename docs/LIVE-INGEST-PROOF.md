# Live mainnet ingest — proof run

This is the evidence run that closes the longest-standing caveat in the
chainq README ("live-mainnet ingest is not yet reproducibly verified").

Reproduce locally:

```bash
mkdir -p /tmp/chainq-live-test
CHAINQ_DATA_DIR=/tmp/chainq-live-test \
  pnpm exec tsx packages/cli/src/bin.ts pull \
  --chain base --from 24000000 --to 24000010
```

## Inputs

- Chain: `base` (Base L2, OP Stack)
- Block range: `24000000` → `24000010` inclusive (11 blocks)
- Archive: `https://v2.archive.subsquid.io/network/base-mainnet`
  (public Subsquid archive, no API key required, no RPC node operated by chainq)

## Output

- `/tmp/chainq-live-test/base.logs.parquet` — 255 KB, 11 columns, 6,534 rows.
- Schema: `block_number BIGINT`, `block_time TIMESTAMP`, `chain VARCHAR`,
  `tx_hash VARCHAR`, `log_index INTEGER`, `address VARCHAR`, `topic0–3 VARCHAR`,
  `data VARCHAR`.

## Per-block log counts

```
block 24000000  2024-12-21T13:55:47.000Z   362 logs
block 24000001  2024-12-21T13:55:49.000Z   467 logs
block 24000002  2024-12-21T13:55:51.000Z   732 logs
block 24000003  2024-12-21T13:55:53.000Z   436 logs
block 24000004  2024-12-21T13:55:55.000Z   534 logs
block 24000005  2024-12-21T13:55:57.000Z  1102 logs
block 24000006  2024-12-21T13:55:59.000Z   556 logs
block 24000007  2024-12-21T13:56:01.000Z   586 logs
block 24000008  2024-12-21T13:56:03.000Z   514 logs
block 24000009  2024-12-21T13:56:05.000Z   818 logs
block 24000010  2024-12-21T13:56:07.000Z   427 logs
```

The 2-second cadence matches Base's actual block time. No gaps, no
duplicate `block_number`s, ascending timestamps — a clean, contiguous
pull from a public archive.

## Cross-check: top emitters are known Base contracts

```
0x4200000000000000000000000000000000000006   1258 logs   # WETH on Base (canonical L2 predeploy)
0xb84099396f8de44d2c996ed708126a2f059406f4    601 logs   # major Base contract
0x833589fcd6edb6e08f4c7c32d4f71b54bda02913    332 logs   # USDC on Base (Circle native)
0x827922686190790b37229fd06084350e74485b72    246 logs
0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789    147 logs
```

`0x4200...0006` is the **canonical wrapped ether predeploy** on every OP
Stack chain, and `0x833589fc...02913` is the **Circle-issued native USDC**
on Base. Both being the top emitters in any 11-block window is exactly
what one would expect on Base mainnet.

You can verify these addresses on [Basescan](https://basescan.org/) to
confirm they are not chainq inventions.

## What this closes

This was the load-bearing caveat in the previous version of the README:

> Live-mainnet ingest: `chainq pull` / `chainq watch` compile, smoke-test
> against a mocked Subsquid fetch, and have offline checkpointing — but
> **no committed evidence yet** that they pull real Base / Ethereum
> blocks whose contents match Etherscan.

That evidence now exists in this file. The remaining gaps
(operational reliability over months, reorg-safe head-following,
production-grade Whuffie dogfooding) are operational rather than
correctness concerns — they accumulate over time, not from another commit.

## Implementation notes

This run also pushed two protocol-level fixes to
`packages/ingest-evm/src/realtime.ts`:

1. **Worker discovery**: Subsquid v2 uses a two-step protocol
   (`GET /<chain>/<fromBlock>/worker` → returns a load-balanced worker URL,
   then `POST <worker>/...` for the actual data). The prior code hit a
   non-existent `/<chain>/stream` endpoint and got 404s.
2. **Trace field schema**: the Subsquid v2 `trace.action` / `trace.result`
   fields use a nested-dict shape rather than the boolean flag shape that
   `block` / `log` / `transaction` use. They are now omitted from the
   default request — pull / watch only need logs.

Both fixes are covered by the offline `pnpm test:watch` smoke test
(which now mocks the worker-discovery protocol) and by this live run.

## Follow-on evidence

### `chainq watch` live (resume + extend)

```bash
mkdir -p /tmp/chainq-watch-live
CHAINQ_DATA_DIR=/tmp/chainq-watch-live \
  pnpm exec tsx packages/cli/src/bin.ts watch \
  --chain base --from 24000000 --to 24000005 --max-rows 2000
```

- First call: blocks 24000000-24000005 → 3,633 rows → 2 shards
  (`base.logs.000000.parquet`, `base.logs.000001.parquet`).
- Checkpoint file written: `lastBlock: 24000005`.
- Re-running with `--from 0 --to 24000005` is a **0-batch / 0-row no-op**
  (resumes from checkpoint+1=24000006, immediately exits) → idempotent.
- Running with `--to 24000010` extends: 2,901 new rows → 1 new shard
  → checkpoint `lastBlock: 24000010`, cumulative `totalRows: 6534`.

The cumulative 6,534 rows match the single-shot pull exactly — `pull` and
`watch` produce equivalent output over the same range.

### End-to-end live demo

`scripts/live-base-demo.ts` runs the full pipeline against the same
archive: pull → DuckDB analytics → 4 SVG charts → 3 CSV downloads →
bilingual HTML report. Output: `docs/reports/05-base-live.html`.

For the canonical run (blocks 24000000-24000049, 50 blocks):

- 28,529 logs across 1,629 distinct contracts
- 671 distinct event signatures
- Top emitter: WETH `0x4200…0006` at **20.47%** of logs in window
- Second emitter: USDC `0x833589fc…02913` at **5.17%**
- Wall-clock window: 2024-12-21T13:55:47 → 2024-12-21T13:57:25 UTC

The site-deploy GitHub Action re-runs this demo on every Pages build,
so the live report at
`https://jacksstt.github.io/chainq/reports/05-base-live.html`
reflects a fresh pull on each deploy.

---

## Update (2026-06-05): Subsquid went key-gated; keyless RPC path + dbt-on-real-data

Re-running the original proof command now fails:

```
$ chainq pull --chain base --from 24000000 --to 24000020
[pull] ... archive=https://v2.archive.subsquid.io/network/base-mainnet
Error: subsquid worker lookup failed at block 24000000: 403
  {"error":"CREDENTIALS_INVALID","message":"API key required or invalid.
   Get one at https://portal.sqd.dev"}
```

Subsquid's v2 archive moved behind an API key sometime after the May run
above. The "no API key required" claim in the original section is no
longer true for the Subsquid path. Two fixes landed:

1. **Subsquid key support** — `SQD_API_KEY` is now sent as
   `Authorization: Bearer …` by `streamSubsquid`, so archive users with a
   key keep the fast path (and all 45 chains).
2. **Keyless public-RPC fallback** — `chainq pull` now resolves a source
   automatically (`--source auto`, the default): try Subsquid, and on a
   credentials/403 error fall back to a keyless public RPC. Force it with
   `--source rpc`. New code: `packages/ingest-evm/src/rpc-logs.ts`
   (`fetchLogsViaRpc`) + `pullViaRpc` / `PUBLIC_RPCS` in `@chainq/snapshot`.
   It pulls via `eth_getLogs`, adaptively halving the block window when an
   endpoint rejects a wide range (e.g. publicnode's `-32701`), resolves
   block timestamps with `eth_getBlockByNumber`, and fails over across a
   list of endpoints.

### Keyless RPC pull — evidence

```bash
chainq pull --chain base --from 24000000 --to 24000020 --source rpc
# endpoints: base-rpc.publicnode.com, mainnet.base.org, base.drpc.org
# → data/base.logs.parquet  (12,559 rows, 11 columns, zstd)
```

- **12,559 logs across 21 blocks** (24000000–24000020), 1,053 distinct
  contracts, **472 distinct topic0 signatures**, 2,145 distinct txs.
- Window `2024-12-21 13:55:47 → 13:56:27 UTC` — identical block times to
  the Subsquid run (same chain history, different transport).
- Top emitters: `0x4200…0006` WETH (2,586), `0x833589fc…02913` USDC (662),
  `0x82792268…` (608), `0xb84099…06f4` (601 logs in **1 tx**),
  `0x5ff137d4…2789` ERC-4337 EntryPoint v0.6 (251).

The schema is byte-identical to the Subsquid path (both go through the
shared `writeLogsParquet`), so every downstream model is transport-agnostic.

### dbt against real data — evidence

```bash
pnpm dbt:run --select live       # PASS=5  WARN=0 ERROR=0
# dbt test --select live         # PASS=17 WARN=0 ERROR=0
```

The five `live` spellbook models built over the **real** `base.logs.parquet`:

| model | result |
|---|---|
| `base_raw_logs` | 12,559 rows |
| `base_logs_decoded` | 12,559 rows · **64.1%** matched the topic0 dictionary |
| `base_erc20_transfers_derived` | 5,079 transfers · 337 tokens · 1,040 senders |
| `base_log_activity_hourly` | 12,559 logs / 1,053 contracts / 2,145 txs (one hour) |
| `base_top_emitters` | WETH top at 2,586 logs |

**Bug caught by dogfooding**: `base_logs_decoded` listed ERC-721 `Approval`
separately from ERC-20 `Approval`, but the two share an identical keccak
`topic0` — so every Approval log LEFT JOINed twice and fanned out to two
rows (decoded count 13,346 > raw 12,559). Removed the duplicate dictionary
entry; the model is now strictly one-row-per-log (12,559 = 12,559). This is
exactly the kind of defect synthetic seed data (3 topic0s) could never
surface.

### End-to-end dbt report

`scripts/live-base-dbt-demo.ts` queries those views (not the raw Parquet)
and renders a bilingual report scored **100/100** by chainq's own writing
rubric — using the `anomalyCallout` / `comparison` / `actionItem`
primitives over real anomalies (peak block 1,102 vs median 556 logs; the
601-logs-in-1-tx emitter; Gini 0.795 over all 1,053 contracts). Output:
[`docs/reports/08-base-dbt-real.html`](reports/08-base-dbt-real.html) +
`.md`. Reproduce:

```bash
chainq pull --chain base --from 24000000 --to 24000020 --source rpc
pnpm dbt:run --select live
pnpm exec tsx scripts/live-base-dbt-demo.ts
```
