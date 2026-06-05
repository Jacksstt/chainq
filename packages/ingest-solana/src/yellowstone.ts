/**
 * @chainq/ingest-solana — Yellowstone gRPC realtime firehose.
 *
 * Yellowstone (the Geyser gRPC plugin, exposed by Triton / Helius) streams
 * Solana transactions, accounts, and slots far faster than RPC polling.
 * Rather than hard-depend on the heavy `@triton-one/yellowstone-grpc`
 * client, this module is written against a small `YellowstoneSource`
 * interface: an async-iterable of updates. The real gRPC client is wired in
 * via `createYellowstoneSource()` (dynamic import, optional peer dep); tests
 * inject `mockYellowstoneSource()`. Same shape as the EVM `streamSubsquid`
 * design — transport is injectable, so the pipeline is offline-testable.
 *
 * Real wiring (requires an endpoint + token from Triton/Helius):
 *   pnpm add @triton-one/yellowstone-grpc
 *   const src = await createYellowstoneSource({ endpoint, token });
 *   for await (const batch of streamYellowstone({ source: src })) { ... }
 */

import type { SolanaTxRow } from "./index.js";

/** A normalised transaction update off the firehose. */
export interface YellowstoneTransactionUpdate {
  slot: number;
  signature: string;
  /** Vote transactions are usually filtered out of analytics. */
  isVote?: boolean;
  /** `meta.err == null`. */
  success: boolean;
  feeLamports: number;
  accountKeys: string[];
}

/** A firehose update — a `oneof` in the real proto; we consume transactions + slots. */
export interface YellowstoneUpdate {
  transaction?: YellowstoneTransactionUpdate;
  slot?: { slot: number; status?: string };
}

/** Subset of the real Subscribe request we set. */
export interface YellowstoneSubscribeRequest {
  transactions?: { vote?: boolean; failed?: boolean; accountInclude?: string[] };
  fromSlot?: number;
}

/** Injectable transport: yields updates for a subscription. */
export interface YellowstoneSource {
  subscribe(req: YellowstoneSubscribeRequest): AsyncIterable<YellowstoneUpdate>;
  /** Optional cleanup. */
  close?(): Promise<void> | void;
}

/** A slot's worth of normalised transaction rows. */
export interface YellowstoneBatch {
  slot: number;
  txs: SolanaTxRow[];
}

export interface StreamYellowstoneOptions {
  source: YellowstoneSource;
  request?: YellowstoneSubscribeRequest;
  /** Inclusive starting slot. */
  fromSlot?: number;
  /** Inclusive ending slot; omit to follow the head. */
  toSlot?: number;
  /** Safety cap on transactions consumed. */
  maxUpdates?: number;
  /** Keep vote transactions (default false). */
  includeVotes?: boolean;
}

/**
 * Drain a Yellowstone source, grouping transaction updates into per-slot
 * batches of normalised `SolanaTxRow`s. Yields one batch per slot boundary.
 */
export async function* streamYellowstone(opts: StreamYellowstoneOptions): AsyncGenerator<YellowstoneBatch> {
  const req: YellowstoneSubscribeRequest = {
    transactions: { vote: opts.includeVotes ?? false, ...(opts.request?.transactions ?? {}) },
    ...(opts.fromSlot != null ? { fromSlot: opts.fromSlot } : {}),
    ...(opts.request ?? {}),
  };

  let currentSlot = -1;
  let buf: SolanaTxRow[] = [];
  let consumed = 0;

  for await (const u of opts.source.subscribe(req)) {
    const t = u.transaction;
    if (!t) continue; // ignore slot/account-only updates for the tx feed
    if (!opts.includeVotes && t.isVote) continue;
    if (opts.fromSlot != null && t.slot < opts.fromSlot) continue;
    if (opts.toSlot != null && t.slot > opts.toSlot) break;

    if (t.slot !== currentSlot && buf.length > 0) {
      yield { slot: currentSlot, txs: buf };
      buf = [];
    }
    currentSlot = t.slot;
    buf.push({
      signature: t.signature,
      slot: t.slot,
      block_time: null, // not carried by the tx update; filled by a backfill join if needed
      fee_lamports: t.feeLamports,
      success: t.success,
      account_keys: t.accountKeys,
    });
    consumed += 1;
    if (opts.maxUpdates && consumed >= opts.maxUpdates) break;
  }
  if (buf.length > 0) yield { slot: currentSlot, txs: buf };
}

/** Convenience: drain a stream into an array (tests / small ranges). */
export async function collectYellowstone(opts: StreamYellowstoneOptions, maxBatches = 100): Promise<YellowstoneBatch[]> {
  const out: YellowstoneBatch[] = [];
  for await (const b of streamYellowstone(opts)) {
    out.push(b);
    if (out.length >= maxBatches) break;
  }
  return out;
}

/**
 * Deterministic in-memory source for tests / demos. Replays the supplied
 * updates (optionally with an async tick so it behaves like a stream).
 */
export function mockYellowstoneSource(updates: YellowstoneUpdate[]): YellowstoneSource {
  return {
    async *subscribe(): AsyncIterable<YellowstoneUpdate> {
      for (const u of updates) {
        // Yield to the event loop so this is a genuine async iterator.
        await Promise.resolve();
        yield u;
      }
    },
  };
}

export interface CreateYellowstoneSourceOptions {
  /** gRPC endpoint, e.g. https://your-endpoint.rpcpool.com:443 */
  endpoint: string;
  /** x-token / API token for the endpoint. */
  token?: string;
}

/**
 * Build a real source backed by `@triton-one/yellowstone-grpc`. The package
 * is an OPTIONAL peer dep — it is dynamically imported so the chainq build
 * stays slim and offline. Install it before calling:
 *
 *   pnpm add @triton-one/yellowstone-grpc
 *
 * The adapter maps the proto `SubscribeUpdate.transaction` into our
 * `YellowstoneUpdate` shape.
 */
export async function createYellowstoneSource(opts: CreateYellowstoneSourceOptions): Promise<YellowstoneSource> {
  let mod: unknown;
  try {
    // Indirect the specifier through a variable so the type-checker does not
    // try to resolve this OPTIONAL peer dep at build time (it is intentionally
    // not installed). Resolution happens at runtime only.
    const pkg = "@triton-one/yellowstone-grpc";
    mod = await import(/* @vite-ignore */ pkg);
  } catch {
    throw new Error(
      "Yellowstone gRPC requires the optional peer dependency. Install it:\n" +
        "  pnpm add @triton-one/yellowstone-grpc\n" +
        "then pass { endpoint, token } from your Triton/Helius gRPC plan.",
    );
  }
  const Client = (mod as { default?: new (e: string, t: string | undefined, o?: unknown) => unknown }).default;
  if (!Client) throw new Error("Yellowstone client export not found in @triton-one/yellowstone-grpc");
  const client = new Client(opts.endpoint, opts.token, undefined) as {
    subscribe(): Promise<AsyncIterable<unknown> & { write(req: unknown): void }>;
  };

  return {
    async *subscribe(req: YellowstoneSubscribeRequest): AsyncIterable<YellowstoneUpdate> {
      const stream = await client.subscribe();
      stream.write({
        transactions: {
          chainq: {
            vote: req.transactions?.vote ?? false,
            failed: req.transactions?.failed ?? true,
            accountInclude: req.transactions?.accountInclude ?? [],
            accountExclude: [],
            accountRequired: [],
          },
        },
        ...(req.fromSlot != null ? { fromSlot: String(req.fromSlot) } : {}),
        commitment: 0, // PROCESSED
        accounts: {},
        slots: {},
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        entry: {},
        transactionsStatus: {},
      });
      for await (const update of stream as AsyncIterable<Record<string, unknown>>) {
        const txWrap = update["transaction"] as Record<string, unknown> | undefined;
        const tx = txWrap?.["transaction"] as Record<string, unknown> | undefined;
        if (!tx) continue;
        const meta = tx["meta"] as Record<string, unknown> | undefined;
        const message = (tx["transaction"] as Record<string, unknown> | undefined)?.["message"] as
          | Record<string, unknown>
          | undefined;
        const sigBytes = tx["signature"];
        yield {
          transaction: {
            slot: Number((txWrap?.["slot"] as string | number | undefined) ?? 0),
            signature: encodeSignature(sigBytes),
            isVote: Boolean(tx["isVote"]),
            success: meta ? meta["err"] == null : true,
            feeLamports: Number((meta?.["fee"] as string | number | undefined) ?? 0),
            accountKeys: decodeAccountKeys(message?.["accountKeys"]),
          },
        };
      }
    },
  };
}

function encodeSignature(sig: unknown): string {
  if (typeof sig === "string") return sig;
  if (sig instanceof Uint8Array) return Buffer.from(sig).toString("base64");
  if (Array.isArray(sig)) return Buffer.from(sig as number[]).toString("base64");
  return "";
}

function decodeAccountKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  return keys.map((k) => {
    if (typeof k === "string") return k;
    if (k instanceof Uint8Array) return Buffer.from(k).toString("base64");
    if (Array.isArray(k)) return Buffer.from(k as number[]).toString("base64");
    return String(k);
  });
}
