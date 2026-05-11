# @chainq/storage

Share chainq snapshots over Filecoin / IPFS.

```ts
import { push, pull } from "@chainq/storage";

// Publish a Parquet to Filecoin
const result = await push({
  filePath: "./data/base.logs.parquet",
  apiKey: process.env.LIGHTHOUSE_API_KEY,
});
console.log("CID:", result.cid);

// Anyone else pulls it back
await pull({
  cid: result.cid,
  outPath: "./data/base.logs.parquet",
});
```

## Provider matrix

| Provider | Status |
|---|---|
| **lighthouse.storage** | ✅ working (Filecoin pinning, IPFS gateway) |
| **web3.storage (w3up)** | 🟡 stub (bootstrap UX is hostile, deferred to v0.1) |

## Why this matters

It closes the last loop of "RPC-free + node-free" chainq. The community can
publish curated Parquet snapshots, and any node can fetch them by CID. No
RPC, no archive operator, no centralised hosting.

Combined with `@chainq/snapshot` and `@chainq/light-client`, this is the
infrastructure for the "true free, true open" path that no analytics
vendor offers today.

## Status

Pre-alpha. CIDs returned are stable; pulling against the public Lighthouse
gateway works without an API key.
