# @chainq/light-client

Trust-minimised verification for chainq query results.

chainq derives rows from Parquet snapshots pulled from a public archive
(`@chainq/snapshot`). A paranoid consumer (an audit, a regulated deployment)
wants to confirm those rows correspond to real chain state **without** running a
full archive node and **without** trusting any single archive or RPC provider.

v0.8.0 ships a **multi-RPC quorum light client**: for the boundary blocks of a
result set, it fetches the authoritative block hash from *N* independent public
RPC endpoints and accepts it only when a **quorum** of them agree. Disagreement
is surfaced in the receipt instead of silently trusting one source.

## Quick start

```ts
import { createQuorumLightClient, verifyRows } from "@chainq/light-client";
import { PUBLIC_RPCS } from "@chainq/snapshot";

// Rows from chainq_query, each with a block_number.
const rows = [
  { block_number: 18_000_000, tx_hash: "0xabc", value: 1 },
  { block_number: 18_000_500, tx_hash: "0xdef", value: 2 },
];

const client = createQuorumLightClient({
  chain: "ethereum",
  rpcUrls: PUBLIC_RPCS.ethereum, // independent keyless endpoints
  // quorum defaults to a simple majority: floor(total/2)+1
});

const receipt = await verifyRows(rows, client);
console.log(receipt);
// {
//   chain: "ethereum",
//   blockRange: { from: 18000000, to: 18000500 },
//   blockHashes: { 18000000: "0x…", 18000500: "0x…" },
//   rowsHash: "0x<sha256>",
//   checkpointTrust: "quorum:2-endpoints",
//   generatedAt: "2026-…Z",
//   verified: true,
//   unverifiedBlocks: [],
//   agreements: { 18000000: "2/2", 18000500: "2/2" }
// }
```

If a block fails to reach quorum, it lands in `unverifiedBlocks`, its
`agreements` entry shows the split (e.g. `"1/3"`), and `verified` is `false`.

### Lower-level quorum tally

```ts
const q = await client.getBlockHashQuorum(18_000_000);
// { hash: "0x…" | null, agree: 3, total: 3, responses: ["0x…", "0x…", "0x…"] }
```

`getBlockHash(n)` throws `Error("no quorum for block N: a/b agreed")` when the
quorum is not met, preserving the plain `LightClient` contract.

### Content hash

`canonicalRowsHash(rows)` returns `0x` + SHA-256 over a canonical JSON
serialization (object keys sorted recursively, array order preserved), so the
same data hashes identically regardless of key ordering. `hashRows` is a
back-compat alias.

## MCP

The chainq MCP server exposes this as the `chainq_verify` tool — pass
`{ rows, chain?, rpcUrls?, quorum? }` and get back the `VerificationReceipt`.
When `rpcUrls` is omitted it defaults to the keyless `PUBLIC_RPCS[chain]` list.

## Trust model & limits

A multi-RPC quorum **reduces** trust: you no longer depend on any single
provider. It is **not** a consensus proof.

- **Quorum ≠ consensus proof.** The quorum can be fooled if a majority of the
  queried providers collude, or if several "independent" endpoints proxy the
  same upstream node.
- **Cross-provider collusion is not defended.** Endpoint independence is
  assumed, not proven.
- **Deeper future level:** a [Helios](https://github.com/a16z/helios)-style
  consensus light client follows sync-committee signatures and proves a block
  hash against the beacon chain instead of counting votes. That is the next
  milestone; quorum is the shippable, dependency-light first step.
