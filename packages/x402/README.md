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
real Base / Solana verifier in v0.2.0.

## Status

Pre-alpha. The gate logic works (quote, nonce, replay prevention). The
default verifier is a stub — wire a real one before billing anyone.
