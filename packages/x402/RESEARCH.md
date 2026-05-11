# Research — x402 for chainq

## Why

If a Prime Beat-style operator runs a public chainq endpoint, they need a
way to bill that doesn't require an account, an API key, or a credit-card
flow. The autonomous-agent ecosystem has converged on
[x402](https://x402.org) for this: HTTP 402 + USDC settlement, no signup.

Nansen launched their public API on this exact pattern in 2026. We need to
match it for the hosted-instance story to be competitive.

## Flow

```
Agent                                Server
  │   call(tool, args)                  │
  ├────────────────────────────────────▶│
  │                                     │  isPaid(tool)?
  │   402 PAYMENT REQUIRED              │
  │     { quote: { nonce, amount, ... }}│
  │◀────────────────────────────────────┤
  │                                     │
  │   pay USDC on Base / Solana         │
  │     memo = nonce                    │
  ├──────────▶ Chain ◀──────────────────│
  │                                     │
  │   call(tool, args, receipt)         │
  ├────────────────────────────────────▶│
  │                                     │  verify(receipt, nonce)
  │   tool result                       │
  │◀────────────────────────────────────┤
```

## Decisions

- **Settlement chains**: Base + Solana. Both have ample USDC liquidity,
  fast finality, and existing x402 client tooling.
- **Pricing unit**: atomic USDC (10^-6). Default ladder mirrors Nansen's
  $0.005 / $0.01 / $0.03 levels.
- **Nonce**: server-generated, embedded as the transfer memo / referenceId.
- **Replay prevention**: server keeps `Set<usedNonce>`, evicts after expiry.
- **MCP transport**: x402 is HTTP-native. To preserve our stdio-first MCP
  story, the chainq MCP server exposes both transports — stdio for local
  agents, HTTP+x402 for hosted access.

## What's free

- Discovery (`list_tables`, `describe`, `list_metrics`) is always free.
  Agents need to introspect before they commit money.
- `estimate_cost` is free for the same reason.
- `recall` is per-session and stays free.

What's paid: `query`, `metric`, `chart_render`, `report`.

## Verification details (target v0.2.0)

- **Base**: query a public RPC for the transaction; assert
  `tx.to == USDC && transfer(to, payTo, amount)` and that `tx.input.memo`
  equals the quoted nonce. Use Subsquid / Alchemy free tier for the lookup.
- **Solana**: parse the SPL transfer via Helius enriched endpoint.
- **Receipt format**: `{ txHash, chain, nonce, payer }`.

## Open questions

- Subscription / streaming credits? For v0.0.x we stay strictly per-call.
- Refunds on failed tool execution? Treat tool errors as "service still
  rendered" to avoid griefing. Document this clearly.
- Multi-currency? Not in v0.x. USDC only.

## Status

v0.0.x: the gate, pricing, quote / settle plumbing all work in-memory. The
verifier is a stub — wire it to a real RPC in v0.2.0. Server integration
(HTTP transport for MCP) is also v0.2.0.
