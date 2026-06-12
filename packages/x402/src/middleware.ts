/**
 * Reusable hosted-mode middleware surface.
 *
 * {@link createX402Gate} is the documented entry point an operator wires into
 * a public chainq endpoint. It is a thin, named wrapper over the {@link Gate}
 * state machine so callers get a small, stable surface (`guard` + `quote`)
 * without depending on the class shape directly.
 *
 * Typical wiring (hosted MCP, HTTP transport):
 *
 * ```ts
 * import { createX402Gate, createBaseUsdcVerifier, FileNonceStore, DEFAULT_PRICING, PaymentRequired } from "@chainq/x402";
 *
 * const gate = createX402Gate({
 *   pricing: { payTo: { base: process.env.CHAINQ_X402_PAYTO_BASE! }, prices: DEFAULT_PRICING.prices },
 *   verify: createBaseUsdcVerifier({ rpcUrls: PUBLIC_RPCS.base, minConfirmations: 1 }),
 *   nonceStore: new FileNonceStore("./.chainq/x402-nonces.json"),
 * });
 *
 * try {
 *   await gate.guard("chainq_query", incomingReceipt);   // free tools: no receipt needed
 *   // …run the tool
 * } catch (err) {
 *   if (err instanceof PaymentRequired) return reply402(err.quote);
 *   throw err;
 * }
 * ```
 */

import { Gate } from "./index.js";
import type {
  PricingTable,
  PaymentVerifier,
  NonceStore,
  PaymentReceipt,
  PaymentQuote,
} from "./index.js";

export interface X402MiddlewareOptions {
  pricing: PricingTable;
  verify: PaymentVerifier;
  nonceStore?: NonceStore;
}

export interface X402Gate {
  /**
   * Enforce payment for a tool call. Free tools resolve immediately; paid
   * tools throw {@link PaymentRequired} (carrying a fresh quote) when no /
   * an unrecognised receipt is supplied, and a plain `Error` when on-chain
   * verification fails.
   */
  guard(tool: string, receipt?: PaymentReceipt): Promise<void>;
  /** Issue a fresh quote for a tool (for proactive 402 responses). */
  quote(tool: string): PaymentQuote;
}

/**
 * Construct the hosted-mode gate. Thin wrapper around {@link Gate}: `guard`
 * delegates to `Gate.settle`, `quote` to `Gate.quote`.
 */
export function createX402Gate(opts: X402MiddlewareOptions): X402Gate {
  const gate = new Gate({
    pricing: opts.pricing,
    verify: opts.verify,
    ...(opts.nonceStore ? { nonceStore: opts.nonceStore } : {}),
  });
  return {
    guard: (tool, receipt) => gate.settle(tool, receipt),
    quote: (tool) => gate.quote(tool),
  };
}
