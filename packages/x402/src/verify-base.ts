/**
 * Real on-chain USDC payment verification on Base.
 *
 * Given a {@link PaymentReceipt} (a tx hash plus the quoted nonce and payer),
 * this confirms — over keyless public JSON-RPC — that the transaction:
 *   1. exists and succeeded (`status == 0x1`),
 *   2. contains an ERC-20 `Transfer` log emitted by the canonical Base USDC
 *      contract, paying the expected `payTo` at least the quoted amount,
 *   3. (optionally) has enough confirmations.
 *
 * It fails closed: any network error, malformed receipt, or missing matching
 * log yields `false` rather than a throw. The Gate treats `false` as
 * "payment not proven" and refuses the call.
 *
 * Caveat: on-chain there is no place to bind the server-issued nonce to the
 * transfer (a plain ERC-20 `transfer` carries no memo), so a single tx could
 * in principle be replayed against multiple nonces. That gap is closed at the
 * store layer by {@link FileNonceStore.consumeTx} (one tx settles once).
 */

import type { PaymentVerifier, PaymentReceipt, PaymentQuote } from "./index.js";

/** Canonical Base mainnet USDC (Circle), lowercase. */
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

/** keccak256("Transfer(address,address,uint256)") — ERC-20 Transfer topic0. */
export const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface BaseUsdcVerifierOptions {
  /** Failover list of keyless Base JSON-RPC endpoints. */
  rpcUrls: string[];
  /** USDC contract to match against (default {@link BASE_USDC}). */
  usdcAddress?: string;
  /** If set, require at least this many confirmations (head − blockNumber + 1). */
  minConfirmations?: number;
  /** Injectable fetch (testing). */
  fetch?: typeof globalThis.fetch;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { message?: string; code?: number };
}

interface RpcLog {
  address?: string;
  topics?: string[];
  data?: string;
}

interface RpcReceipt {
  status?: string;
  from?: string;
  blockNumber?: string;
  logs?: RpcLog[];
}

/**
 * The low 20 bytes of a 32-byte, zero-padded topic, normalised to a lowercase
 * `0x…40hex` address. Returns `null` if the topic is malformed.
 */
function topicToAddress(topic: string | undefined): string | null {
  if (typeof topic !== "string") return null;
  const hex = topic.startsWith("0x") ? topic.slice(2) : topic;
  if (hex.length < 40) return null;
  return "0x" + hex.slice(hex.length - 40).toLowerCase();
}

/** Parse a hex quantity ("0x…") into a BigInt. Empty / "0x" → 0n. */
function hexToBigInt(value: string | undefined): bigint {
  if (typeof value !== "string" || value === "" || value === "0x") return 0n;
  try {
    return BigInt(value.startsWith("0x") ? value : "0x" + value);
  } catch {
    return 0n;
  }
}

/**
 * Build a {@link PaymentVerifier} that proves a Base USDC transfer on-chain.
 *
 * The returned verifier only handles `chain === "base"`; for any other chain
 * it returns `false`.
 */
export function createBaseUsdcVerifier(opts: BaseUsdcVerifierOptions): PaymentVerifier {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const urls = opts.rpcUrls.filter((u): u is string => Boolean(u));
  const usdc = (opts.usdcAddress ?? BASE_USDC).toLowerCase();

  /** Single JSON-RPC call with simple failover to the next URL on error. */
  async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
    let lastErr: unknown;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      if (!url) continue;
      try {
        const resp = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        if (!resp.ok) {
          lastErr = new Error(`${method} HTTP ${resp.status} from ${url}`);
          continue; // transport-ish — try the next endpoint
        }
        const json = (await resp.json()) as JsonRpcResponse<T>;
        if (json.error) {
          lastErr = new Error(`${method}: ${json.error.message ?? "rpc error"}`);
          continue; // try the next endpoint
        }
        return (json.result ?? null) as T | null;
      } catch (e) {
        lastErr = e;
        continue;
      }
    }
    // Exhausted all endpoints — fail closed.
    void lastErr;
    return null;
  }

  return async (receipt: PaymentReceipt, expected: PaymentQuote): Promise<boolean> => {
    try {
      // Only Base is handled here.
      if (expected.chain !== "base" || receipt.chain !== "base") return false;
      if (urls.length === 0) return false;

      const wantPayTo = expected.payTo.toLowerCase();
      const wantAmount = BigInt(expected.amountUsdcAtomic);

      const txReceipt = await rpc<RpcReceipt | null>("eth_getTransactionReceipt", [
        receipt.txHash,
      ]);
      if (!txReceipt) return false;
      // Reverted / failed transactions never count.
      if (txReceipt.status !== "0x1") return false;

      // Optionally bind the payer to the tx sender. Don't hard-fail if the
      // receipt omitted a payer (it's optional metadata, the transfer log is
      // the source of truth).
      if (receipt.payer && txReceipt.from) {
        if (receipt.payer.toLowerCase() !== txReceipt.from.toLowerCase()) return false;
      }

      // Scan logs for a matching USDC Transfer.
      const logs = txReceipt.logs ?? [];
      let matched = false;
      for (const log of logs) {
        if (!log) continue;
        if ((log.address ?? "").toLowerCase() !== usdc) continue;
        const topics = log.topics ?? [];
        if (topics.length < 3) continue;
        if ((topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC0) continue;
        const to = topicToAddress(topics[2]); // Transfer(from, to, value): topics[2] is `to`
        if (to !== wantPayTo) continue;
        const value = hexToBigInt(log.data);
        if (value < wantAmount) continue;
        matched = true;
        break;
      }
      if (!matched) return false;

      // Confirmation depth, if required.
      if (opts.minConfirmations && opts.minConfirmations > 0) {
        const headHex = await rpc<string | null>("eth_blockNumber", []);
        if (!headHex) return false;
        const head = hexToBigInt(headHex);
        const txBlock = hexToBigInt(txReceipt.blockNumber);
        if (txBlock === 0n) return false;
        const confirmations = head - txBlock + 1n;
        if (confirmations < BigInt(opts.minConfirmations)) return false;
      }

      return true;
    } catch {
      // Fail closed on any unexpected error.
      return false;
    }
  };
}
