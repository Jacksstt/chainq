#!/usr/bin/env tsx
/**
 * Offline smoke test for `@chainq/x402` v0.7.0 — exercises the real Base USDC
 * verifier, the persistent file-backed nonce store, and the hosted-mode
 * middleware against a MOCK `fetch`. No network is contacted.
 *
 * Asserts:
 *  - free tool (chainq_describe) settles with no receipt
 *  - paid tool (chainq_query) without a receipt throws PaymentRequired + quote
 *  - paid tool with a VALID receipt (matching nonce + canned tx) settles
 *  - replay of the same nonce throws
 *  - an UNDERPAYMENT mock (value < amount) fails verification
 *  - a FAILED-status tx fails verification
 *  - FileNonceStore persistence: a SECOND store on the same file sees the
 *    nonce as already-used; consumeTx dedupes a tx hash
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Gate,
  createX402Gate,
  createBaseUsdcVerifier,
  FileNonceStore,
  PaymentRequired,
  BASE_USDC,
  TRANSFER_TOPIC0,
  DEFAULT_PRICING,
} from "../packages/x402/src/index.ts";
import type { PaymentReceipt, PaymentQuote, PricingTable } from "../packages/x402/src/index.ts";

const PAY_TO = "0x000000000000000000000000000000000000beef";
const PAYER = "0x00000000000000000000000000000000000000aa";

/** Zero-pad a 20-byte address to a 32-byte topic. */
function addrToTopic(addr: string): string {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  return "0x" + hex.padStart(64, "0");
}

/** Encode a bigint as a 32-byte hex data word. */
function amountToData(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

interface MockReceiptOptions {
  status?: string; // default "0x1"
  to?: string; // transfer recipient (default PAY_TO)
  value?: bigint; // transfer amount (default = quoted amount)
  tokenAddress?: string; // log emitter (default BASE_USDC)
  from?: string; // tx sender (default PAYER)
  blockNumber?: string; // default "0x10"
}

/**
 * Build a mock fetch that replies to eth_getTransactionReceipt with a canned
 * receipt carrying a single USDC Transfer log, and to eth_blockNumber with a
 * fixed head. `valueFor` lets the receipt mirror the quoted amount.
 */
function makeMockFetch(
  quoteAmount: bigint,
  o: MockReceiptOptions = {},
): typeof globalThis.fetch {
  return async (_input, init) => {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
      method?: string;
    };
    let result: unknown = null;
    if (body.method === "eth_getTransactionReceipt") {
      result = {
        status: o.status ?? "0x1",
        from: o.from ?? PAYER,
        blockNumber: o.blockNumber ?? "0x10",
        logs: [
          {
            address: o.tokenAddress ?? BASE_USDC,
            topics: [
              TRANSFER_TOPIC0,
              addrToTopic(PAYER), // from
              addrToTopic(o.to ?? PAY_TO), // to
            ],
            data: amountToData(o.value ?? quoteAmount),
          },
        ],
      };
    } else if (body.method === "eth_blockNumber") {
      result = "0x20";
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const PRICING: PricingTable = {
  payTo: { base: PAY_TO },
  prices: DEFAULT_PRICING.prices,
};

const QUOTE_AMOUNT = BigInt(
  DEFAULT_PRICING.prices.find((p) => p.tool === "chainq_query")?.priceUsdcAtomic ?? 10_000,
);

/** A receipt that points at the canned tx and carries the issued nonce. */
function receiptFor(nonce: string, txHash = "0xabc123"): PaymentReceipt {
  return { txHash, chain: "base", nonce, payer: PAYER };
}

async function main() {
  // -------------------------------------------------------------------------
  // free tool settles with no receipt
  // -------------------------------------------------------------------------
  {
    const gate = createX402Gate({
      pricing: PRICING,
      verify: createBaseUsdcVerifier({ rpcUrls: ["http://mock"], fetch: makeMockFetch(QUOTE_AMOUNT) }),
    });
    await gate.guard("chainq_describe"); // must not throw
    console.log("[x402-smoke] free tool settles ok");
  }

  // -------------------------------------------------------------------------
  // paid tool without a receipt → PaymentRequired carrying a quote
  // -------------------------------------------------------------------------
  {
    const gate = createX402Gate({
      pricing: PRICING,
      verify: createBaseUsdcVerifier({ rpcUrls: ["http://mock"], fetch: makeMockFetch(QUOTE_AMOUNT) }),
    });
    let caught: unknown;
    try {
      await gate.guard("chainq_query");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof PaymentRequired, "expected PaymentRequired for unpaid query");
    const quote = (caught as PaymentRequired).quote;
    assert.equal(quote.tool, "chainq_query", "quote names the tool");
    assert.equal(quote.payTo, PAY_TO, "quote carries payTo");
    assert.equal(quote.amountUsdcAtomic, Number(QUOTE_AMOUNT), "quote carries amount");
    assert.ok(quote.nonce, "quote carries a nonce");
    console.log("[x402-smoke] unpaid paid-tool → PaymentRequired ok");
  }

  // -------------------------------------------------------------------------
  // valid receipt settles; replay of same nonce throws
  // -------------------------------------------------------------------------
  {
    const gate = new Gate({
      pricing: PRICING,
      verify: createBaseUsdcVerifier({ rpcUrls: ["http://mock"], fetch: makeMockFetch(QUOTE_AMOUNT) }),
    });
    const quote = gate.quote("chainq_query");
    await gate.settle("chainq_query", receiptFor(quote.nonce)); // valid → ok
    console.log("[x402-smoke] valid receipt settles ok");

    // Replay of the same nonce must throw (nonce already used).
    let replayCaught: unknown;
    try {
      await gate.settle("chainq_query", receiptFor(quote.nonce));
    } catch (e) {
      replayCaught = e;
    }
    assert.ok(replayCaught instanceof Error, "replay should throw");
    assert.match((replayCaught as Error).message, /already used|not recognized/i, "replay rejected");
    console.log("[x402-smoke] nonce replay rejected ok");
  }

  // -------------------------------------------------------------------------
  // underpayment fails verification
  // -------------------------------------------------------------------------
  {
    const gate = new Gate({
      pricing: PRICING,
      verify: createBaseUsdcVerifier({
        rpcUrls: ["http://mock"],
        fetch: makeMockFetch(QUOTE_AMOUNT, { value: QUOTE_AMOUNT - 1n }),
      }),
    });
    const quote = gate.quote("chainq_query");
    let caught: unknown;
    try {
      await gate.settle("chainq_query", receiptFor(quote.nonce));
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error, "underpayment should fail");
    assert.match((caught as Error).message, /verification failed/i, "underpayment → verification failed");
    console.log("[x402-smoke] underpayment fails verification ok");
  }

  // -------------------------------------------------------------------------
  // failed-status tx fails verification
  // -------------------------------------------------------------------------
  {
    const gate = new Gate({
      pricing: PRICING,
      verify: createBaseUsdcVerifier({
        rpcUrls: ["http://mock"],
        fetch: makeMockFetch(QUOTE_AMOUNT, { status: "0x0" }),
      }),
    });
    const quote = gate.quote("chainq_query");
    let caught: unknown;
    try {
      await gate.settle("chainq_query", receiptFor(quote.nonce));
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error, "failed-status tx should fail");
    assert.match((caught as Error).message, /verification failed/i, "failed tx → verification failed");
    console.log("[x402-smoke] failed-status tx fails verification ok");
  }

  // -------------------------------------------------------------------------
  // minConfirmations: enough confirmations passes (head 0x20 − block 0x10 + 1)
  // -------------------------------------------------------------------------
  {
    const verify = createBaseUsdcVerifier({
      rpcUrls: ["http://mock"],
      fetch: makeMockFetch(QUOTE_AMOUNT),
      minConfirmations: 3,
    });
    const quote: PaymentQuote = {
      tool: "chainq_query",
      chain: "base",
      payTo: PAY_TO,
      amountUsdcAtomic: Number(QUOTE_AMOUNT),
      nonce: "n",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    assert.equal(await verify(receiptFor("n"), quote), true, "17 confirmations ≥ 3 should pass");

    const strict = createBaseUsdcVerifier({
      rpcUrls: ["http://mock"],
      fetch: makeMockFetch(QUOTE_AMOUNT),
      minConfirmations: 100,
    });
    assert.equal(await strict(receiptFor("n"), quote), false, "17 confirmations < 100 should fail");
    console.log("[x402-smoke] minConfirmations gate ok");
  }

  // -------------------------------------------------------------------------
  // wrong chain returns false
  // -------------------------------------------------------------------------
  {
    const verify = createBaseUsdcVerifier({ rpcUrls: ["http://mock"], fetch: makeMockFetch(QUOTE_AMOUNT) });
    const solQuote: PaymentQuote = {
      tool: "chainq_query",
      chain: "solana",
      payTo: PAY_TO,
      amountUsdcAtomic: Number(QUOTE_AMOUNT),
      nonce: "n",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    assert.equal(await verify({ ...receiptFor("n"), chain: "solana" }, solQuote), false, "non-base → false");
    console.log("[x402-smoke] non-base chain rejected ok");
  }

  // -------------------------------------------------------------------------
  // FileNonceStore persistence + consumeTx dedupe
  // -------------------------------------------------------------------------
  {
    const dir = mkdtempSync(join(tmpdir(), "x402-smoke-"));
    const file = join(dir, "nonces.json");
    const expiry = Date.now() + 5 * 60 * 1000;

    const storeA = new FileNonceStore(file);
    storeA.remember("nonce-1", expiry);
    assert.equal(storeA.consume("nonce-1"), true, "first consume succeeds");
    assert.equal(storeA.consume("nonce-1"), false, "second consume on same store fails");

    // A fresh store on the SAME file must see the nonce as already-used.
    const storeB = new FileNonceStore(file);
    assert.equal(storeB.consume("nonce-1"), false, "persisted used-nonce rejected by new store");

    // An unknown nonce is rejected (never issued / persisted here).
    assert.equal(storeB.consume("nonce-unknown"), false, "unknown nonce rejected");

    // consumeTx: one tx settles once, even across store instances.
    assert.equal(storeA.consumeTx("0xDEADBEEF"), true, "first tx settle succeeds");
    assert.equal(storeA.consumeTx("0xdeadbeef"), false, "same tx (case-insensitive) deduped");
    const storeC = new FileNonceStore(file);
    assert.equal(storeC.consumeTx("0xDEADBEEF"), false, "persisted tx deduped by new store");
    console.log("[x402-smoke] FileNonceStore persistence + consumeTx ok");
  }

  // -------------------------------------------------------------------------
  // end-to-end with FileNonceStore wired into the gate
  // -------------------------------------------------------------------------
  {
    const dir = mkdtempSync(join(tmpdir(), "x402-smoke-gate-"));
    const file = join(dir, "nonces.json");
    const gate = createX402Gate({
      pricing: PRICING,
      verify: createBaseUsdcVerifier({ rpcUrls: ["http://mock"], fetch: makeMockFetch(QUOTE_AMOUNT) }),
      nonceStore: new FileNonceStore(file),
    });
    const quote = gate.quote("chainq_query");
    await gate.guard("chainq_query", receiptFor(quote.nonce)); // valid → ok
    console.log("[x402-smoke] gate + FileNonceStore end-to-end ok");
  }

  console.log("[x402-smoke] ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
