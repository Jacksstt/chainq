# @chainq/ingest-evm

EVM data ingestion. Backfill via [cryo](https://github.com/paradigmxyz/cryo); realtime / historic streaming via [Subsquid archives](https://docs.sqd.dev/).

## Two paths

### `backfill()` (cryo)

Shell out to the cryo Rust binary to write Parquet partitions to disk. Best for
one-off historical ranges.

### `streamSubsquid()` (Subsquid)

Async iterator over a Subsquid archive's `/stream` endpoint. No cryo binary
required. Best for keeping up with the head of a chain, or for environments
without Rust toolchain. Caller checkpoints the last-seen block.

```ts
import { streamSubsquid } from "@chainq/ingest-evm";

for await (const batch of streamSubsquid({
  archiveUrl: "https://v2.archive.subsquid.io/network/base-mainnet",
  fromBlock: 18_000_000,
  request: { logs: [{ topic0: ["0xddf..."] }] },
})) {
  console.log(batch.header.number, batch.logs?.length);
}
```

## Prerequisites

```bash
# cryo (Rust binary)
cargo install cryo_cli
# or
brew install paradigmxyz/brew/cryo
```

## Status

Pre-alpha. Real cryo wiring lands in `v0.0.1`.
