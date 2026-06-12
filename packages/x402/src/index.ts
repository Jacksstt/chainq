/**
 * @chainq/x402 — pay-per-call gating for chainq tools.
 *
 * x402 (https://x402.org) is the "402 Payment Required" pattern revived as a
 * primitive for autonomous agents. A server returns 402 with a quote; the
 * agent settles a USDC transfer onchain; the server verifies the receipt and
 * fulfils the request.
 *
 * chainq operators who run a public MCP endpoint (the hosted-instance model)
 * can wrap their tools with this middleware to bill per call without an
 * account, an API key, or a subscription. Self-hosted users do not need it.
 *
 * v0.0.x ships:
 *   - the pricing table type and a default catalogue
 *   - the request → quote → verify state machine
 *   - an in-memory replay-prevention store (sessionless)
 *
 * Verification of an actual USDC transfer is stubbed — wire it up in v0.2.0
 * when we attach to a Base / Solana RPC.
 */

export type PaymentChain = "base" | "solana";

export interface ToolPrice {
  /** Tool name as it appears in MCP. */
  tool: string;
  /** Quoted price in USDC (atomic units, e.g. 10_000 = $0.01). */
  priceUsdcAtomic: number;
  /** Settlement chain. */
  chain: PaymentChain;
}

export interface PricingTable {
  payTo: { base?: string; solana?: string };
  prices: ToolPrice[];
}

/**
 * Default catalogue. Mirrors Nansen's basic tier order of magnitude.
 */
export const DEFAULT_PRICING: PricingTable = {
  payTo: {},
  prices: [
    { tool: "chainq_query",         priceUsdcAtomic: 10_000, chain: "base" },   // $0.01
    { tool: "chainq_metric",        priceUsdcAtomic: 30_000, chain: "base" },   // $0.03
    { tool: "chainq_estimate_cost", priceUsdcAtomic: 0,      chain: "base" },   // free
    { tool: "chainq_describe",      priceUsdcAtomic: 0,      chain: "base" },   // free
    { tool: "chainq_list_tables",   priceUsdcAtomic: 0,      chain: "base" },   // free
    { tool: "chainq_list_metrics",  priceUsdcAtomic: 0,      chain: "base" },   // free
    { tool: "chainq_recall",        priceUsdcAtomic: 0,      chain: "base" },   // free
    { tool: "chainq_chart_render",  priceUsdcAtomic: 5_000,  chain: "base" },   // $0.005
    { tool: "chainq_report",        priceUsdcAtomic: 5_000,  chain: "base" },   // $0.005
  ],
};

export interface PaymentQuote {
  tool: string;
  chain: PaymentChain;
  payTo: string;
  amountUsdcAtomic: number;
  /** Nonce the client should include in the memo / referenceId of the transfer. */
  nonce: string;
  /** Expiry — quote should be re-requested after this. */
  expiresAt: string;
}

export interface PaymentReceipt {
  txHash: string;
  chain: PaymentChain;
  nonce: string;
  payer: string;
}

export interface GateOptions {
  pricing?: PricingTable;
  verify?: PaymentVerifier;
  nonceStore?: NonceStore;
}

export type PaymentVerifier = (receipt: PaymentReceipt, expected: PaymentQuote) => Promise<boolean>;

export interface NonceStore {
  consume(nonce: string): boolean;
  remember(nonce: string, expiresAt: number): void;
  /**
   * Dedupe by settlement transaction hash: returns true the first time a tx
   * hash is seen (and records it), false when it already settled a call.
   * `Gate.settle` invokes this after on-chain verification succeeds, so one
   * real payment settles exactly once even though a plain ERC-20 transfer
   * carries no memo to bind it to the server-issued nonce. Optional for
   * backwards compatibility with custom stores; when absent, the gate skips
   * the tx-hash dedupe and relies on nonce replay-protection alone.
   */
  consumeTx?(txHash: string): boolean;
}

export class Gate {
  private readonly pricing: PricingTable;
  private readonly verify: PaymentVerifier;
  private readonly nonces: NonceStore;
  private readonly pending = new Map<string, PaymentQuote>();

  constructor(opts: GateOptions = {}) {
    this.pricing = opts.pricing ?? DEFAULT_PRICING;
    this.verify = opts.verify ?? defaultStubVerifier;
    this.nonces = opts.nonceStore ?? new InMemoryNonceStore();
  }

  /** Look up the price of a tool. */
  priceOf(tool: string): ToolPrice | undefined {
    return this.pricing.prices.find((p) => p.tool === tool);
  }

  /** Issue a quote that the caller can settle and then redeem. */
  quote(tool: string): PaymentQuote {
    const price = this.priceOf(tool);
    if (!price) throw new Error(`unpriced tool: ${tool}`);
    const payTo = this.pricing.payTo[price.chain];
    if (!payTo) throw new Error(`no payTo configured for chain ${price.chain}`);
    const nonce = randomNonce();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const quote: PaymentQuote = {
      tool,
      chain: price.chain,
      payTo,
      amountUsdcAtomic: price.priceUsdcAtomic,
      nonce,
      expiresAt,
    };
    this.pending.set(nonce, quote);
    this.nonces.remember(nonce, new Date(expiresAt).getTime());
    return quote;
  }

  /**
   * Settle a tool invocation. If the tool is free, returns immediately. If
   * it is paid, verifies the receipt matches an outstanding quote, that the
   * nonce has not been used, and that the settlement tx has not already
   * settled another call (one on-chain payment redeems exactly once).
   */
  async settle(tool: string, receipt?: PaymentReceipt): Promise<void> {
    const price = this.priceOf(tool);
    if (!price) throw new Error(`unpriced tool: ${tool}`);
    if (price.priceUsdcAtomic === 0) return;

    if (!receipt) throw new PaymentRequired(`payment required for ${tool}`, this.quote(tool));

    const expected = this.pending.get(receipt.nonce);
    if (!expected) throw new PaymentRequired(`nonce not recognized — request a fresh quote`, this.quote(tool));

    if (!this.nonces.consume(receipt.nonce)) throw new Error(`nonce already used`);

    const ok = await this.verify(receipt, expected);
    if (!ok) throw new Error(`payment verification failed`);

    // Tx-hash dedupe runs only AFTER verification succeeds, so a transient
    // RPC failure does not burn the tx for a later retry. A `false` here
    // means this on-chain payment already settled a different nonce — reject.
    if (this.nonces.consumeTx?.(receipt.txHash) === false) {
      throw new Error(`transaction already settled — one payment redeems exactly once`);
    }
    this.pending.delete(receipt.nonce);
  }
}

export class PaymentRequired extends Error {
  readonly quote: PaymentQuote;
  constructor(message: string, quote: PaymentQuote) {
    super(message);
    this.name = "PaymentRequired";
    this.quote = quote;
  }
}

class InMemoryNonceStore implements NonceStore {
  private readonly used = new Set<string>();
  private readonly seen = new Map<string, number>();
  private readonly usedTx = new Set<string>();
  remember(nonce: string, expiresAt: number): void {
    this.seen.set(nonce, expiresAt);
  }
  consume(nonce: string): boolean {
    if (this.used.has(nonce)) return false;
    if (!this.seen.has(nonce)) return false;
    this.used.add(nonce);
    return true;
  }
  consumeTx(txHash: string): boolean {
    const key = txHash.toLowerCase();
    if (this.usedTx.has(key)) return false;
    this.usedTx.add(key);
    return true;
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const defaultStubVerifier: PaymentVerifier = async (_receipt, _expected) => {
  throw new Error(
    "no PaymentVerifier configured — pass one in GateOptions that confirms the on-chain transfer.",
  );
};

// v0.7.0 — production-real surface: Base USDC verifier, persistent replay-proof
// store, and the named hosted-mode middleware. Appended so existing exports
// above are untouched.
export * from "./verify-base.js";
export * from "./persistent-store.js";
export * from "./middleware.js";
