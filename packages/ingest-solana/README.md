# @chainq/ingest-solana

Solana ingestion via [Helius](https://helius.dev).

## Why Helius

- Reliable JSON-RPC at scale.
- Free tier covers POC volume.
- Their enriched `/v0/addresses/.../transactions` endpoint already parses SPL
  token transfers, NFT events, jupiter routes, and the long tail of program
  semantics — saving us from rebuilding a Solana program decoder.

## API

```ts
import { HeliusClient } from "@chainq/ingest-solana";

const helius = new HeliusClient({ apiKey: process.env.HELIUS_API_KEY! });

const sigs   = await helius.signaturesFor("So11111111111111111111111111111111111111112");
const enrich = await helius.enrichedTransactions("9WzDXwBbm...");
const xfers  = await helius.fetchTokenTransfers("9WzDXwBbm...", 200);
```

## Status

v0.0.x ships the client + token-transfer projection. A Parquet writer and
checkpointing layer land in v0.1.0. Realtime via Yellowstone gRPC is v0.3.0.
