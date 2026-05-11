# Research notes — trust-minimised chainq via light clients

## Problem

Pulling Parquet from a public Subsquid archive is cheap, but you're trusting
the archive operator. For regulated deployments, audit trails, or simply
"prove this number to a counterparty" workflows we need an alternative.

Running a full node solves it but costs hundreds of GB and days of sync. A
light client splits the difference: it follows committee signatures (Altair
sync committees on Ethereum, equivalent constructs on L2s) and gets
authoritative block hashes without holding the entire state.

## Candidate libraries

| Project | Language | Status (2026-05) | Notes |
|---|---|---|---|
| **[Helios](https://github.com/a16z/helios)** | Rust | Production-grade for mainnet ETH | a16z-backed, widely used. WASM bindings exist; Node consumption needs `wasm-bindgen` wrappers. |
| **[Lodestar light client](https://github.com/ChainSafe/lodestar/tree/unstable/packages/light-client)** | TypeScript | Production-grade | Native JS, perfect ergonomics. Heavier than Helios. |
| **[Nimbus light-client](https://github.com/status-im/nimbus-eth1/tree/master/nimbus_verified_proxy)** | Nim | Production | Compiled binary; less friendly to embed. |

**Recommendation**: ship with **Lodestar** for v0.2.0 (pure TS, no FFI), and
optionally support Helios WASM for users who already have it. This avoids a
Rust toolchain dependency for chainq users.

## API shape

```ts
import { createLightClient, verifyRows } from "@chainq/light-client";

const lc = createLightClient({
  checkpoint: "0x..."  // weak-subjectivity checkpoint from Beaconcha.in or similar
});

const result = await chainqQuery({ sql: "..." });
const receipt = await verifyRows(result.rows, lc);
// receipt now contains canonical block hashes + content-hash of the rows.
```

The receipt is a portable JSON blob a third party can re-verify by running
their own light client and checking the block hashes.

## Hybrid usage with @chainq/snapshot

```
┌─────────────┐    pull        ┌─────────────────┐
│   Subsquid   │ ─────────────▶│  Parquet on FS  │
└─────────────┘                 └────────┬────────┘
                                          │
                                          ▼
                                ┌─────────────────┐
                                │ chainq_query    │
                                └────────┬────────┘
                                          │
                          ┌───────────────┴──────────────┐
                          │                              │
                  result rows                    block_range
                          │                              │
                          ▼                              ▼
                  ┌─────────────────┐         ┌───────────────────┐
                  │ verifyRows()    │  ────▶  │ Lodestar / Helios │
                  └────────┬────────┘         └───────────────────┘
                           ▼
                  ┌─────────────────┐
                  │ VerificationReceipt │
                  └─────────────────┘
```

Crucial: **this is opt-in**. 90% of users will never invoke it. But its
existence is the differentiator that makes chainq usable in regulated
contexts where Dune literally cannot go.

## Cost / footprint

| | chainq + Subsquid | chainq + Subsquid + light client |
|---|---|---|
| Initial setup | ~1 minute | ~30 seconds (one extra trusted checkpoint) |
| Disk | ~GB per chain | + ~50 MB for client state |
| RAM | < 1 GB | + 100-200 MB |
| Trust assumption | Subsquid not malicious | 2/3 of Ethereum sync committee honest |

The latter is the same trust model used by every Ethereum mobile wallet —
extremely well-studied.

## Roadmap

- **v0.2.0**: Lodestar-backed light client, `verifyRows()` actually verifies.
- **v0.3.0**: Light client for Base / OP / Arbitrum (uses Ethereum LC + L2
  state root proofs).
- **v0.5.0**: Solana light client (lite-rpc / TipRouter), Filecoin (no LC yet).
