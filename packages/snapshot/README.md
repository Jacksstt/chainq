# @chainq/snapshot

Pull and publish Parquet snapshots for chainq.

The reason this package exists: **you should not have to run a full
Ethereum node to query DEX trades from last week**. Snapshots let chainq
operate without any RPC subscription, using publicly available archives.

## Pull from a public Subsquid archive

```ts
import { pull, PUBLIC_ARCHIVES } from "@chainq/snapshot";

await pull({
  chain: "base",
  archiveUrl: PUBLIC_ARCHIVES.base,
  fromBlock: 18_000_000,
  toBlock: 18_001_000,
  outDir: "./data",
  logFilter: { topic0: ["0xddf252ad..."] }, // ERC20 Transfer
});
```

Output: `data/base.logs.parquet`. zstd-compressed via DuckDB's `COPY`.

## From the CLI

```bash
chainq pull --chain base --from 18000000 --to 18001000
```

## Status

- v0.0.x: logs dataset, single-Subsquid-source, single output file.
- v0.1.0: transactions / traces, parallel batches, partitioned output
  (`chain=base/year=2026/month=01/...`).
- v0.2.0: Filecoin / IPFS hosted snapshots with content-hash addressing.
