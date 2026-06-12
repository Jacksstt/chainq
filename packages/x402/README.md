# @chainq/x402

Pay-per-call gating for chainq tools using the [x402](https://x402.org) pattern.

Use this only if you intend to **operate a public chainq endpoint**. For
self-hosted local use you don't need it — there's nothing to bill.

## Quickstart

```ts
import { Gate, DEFAULT_PRICING, PaymentRequired } from "@chainq/x402";

const gate = new Gate({
  pricing: {
    payTo: { base: "0xYourReceivingAddress" },
    prices: DEFAULT_PRICING.prices,
  },
  verify: async (receipt, expected) => {
    // call your Base RPC, assert a USDC transfer of `expected.amountUsdcAtomic`
    // to `expected.payTo` with memo `receipt.nonce` exists in `receipt.txHash`.
    return await verifyOnBase(receipt, expected);
  },
});

try {
  await gate.settle("chainq_query", incomingReceipt);
  // …run the actual query
} catch (err) {
  if (err instanceof PaymentRequired) {
    return reply402(err.quote);   // include the quote in the response body
  }
  throw err;
}
```

## Pricing surface

| Tool | Price |
|---|---|
| `chainq_list_tables` | free |
| `chainq_describe` | free |
| `chainq_list_metrics` | free |
| `chainq_estimate_cost` | free |
| `chainq_recall` | free |
| `chainq_query` | $0.01 |
| `chainq_metric` | $0.03 |
| `chainq_chart_render` | $0.005 |
| `chainq_report` | $0.005 |

See [`RESEARCH.md`](RESEARCH.md) for the design and the migration plan to a
real Base / Solana verifier.

## Real Base USDC verification (v0.7.0)

`createBaseUsdcVerifier` proves a payment by reading the transaction receipt
over keyless public JSON-RPC and matching an ERC-20 `Transfer` log emitted by
the canonical Base USDC contract:

```ts
import {
  createX402Gate,
  createBaseUsdcVerifier,
  FileNonceStore,
  DEFAULT_PRICING,
  PaymentRequired,
} from "@chainq/x402";
import { PUBLIC_RPCS } from "@chainq/snapshot";

const gate = createX402Gate({
  pricing: { payTo: { base: process.env.CHAINQ_X402_PAYTO_BASE! }, prices: DEFAULT_PRICING.prices },
  verify: createBaseUsdcVerifier({ rpcUrls: PUBLIC_RPCS.base, minConfirmations: 1 }),
  nonceStore: new FileNonceStore("./.chainq/x402-nonces.json"), // survives restarts
});

try {
  await gate.guard("chainq_query", incomingReceipt);   // free tools: receipt optional
  // …run the tool
} catch (err) {
  if (err instanceof PaymentRequired) return reply402(err.quote);
  throw err;
}
```

The verifier fails closed (any RPC error / missing matching log → `false`).
It checks: tx exists and `status == 0x1`, a USDC `Transfer` to the quoted
`payTo` for at least the quoted amount, and (optionally) confirmation depth.

### Replay & one-tx-one-settlement

`FileNonceStore` persists `seen` / `used` nonces and `usedTx` hashes to a JSON
file (atomic tmp + rename), so a restarted endpoint still rejects a settled
nonce. Because a plain ERC-20 transfer carries no memo, the server-issued
nonce can't be bound on-chain — `consumeTx(txHash)` closes that gap: one real
transfer settles exactly once even if referenced by multiple nonces.

## Wiring into the MCP server (hosted mode)

The chainq MCP server (`@chainq/mcp-server`) registers each tool individually
through the MCP SDK's `server.tool(...)`, so there is no single dispatch
choke point to drop a gate into without touching every paid tool's schema and
handler. Rather than force a high-risk edit, the gate is exposed here as the
public surface. A hosted operator wraps each paid tool's handler:

```ts
// hosted-mode handler wrapper (env-gated; self-hosted stays free)
const x402Enabled = process.env.CHAINQ_X402_ENABLED === "1" && !!process.env.CHAINQ_X402_PAYTO_BASE;
async function withGate(tool: string, args: { _payment?: PaymentReceipt }, run: () => Promise<R>) {
  if (!x402Enabled) return run();                       // local / self-hosted: free
  try { await gate.guard(tool, args._payment); }        // verify on-chain
  catch (e) { if (e instanceof PaymentRequired) return reply402(e.quote); throw e; }
  return run();
}
```

## Status

Beta. Gate logic (quote, nonce, replay prevention), a real Base USDC verifier,
and a persistent replay-proof store all work and are smoke-tested offline
(`pnpm test:x402`). Solana verification and the HTTP MCP transport remain
future work.
