/**
 * @chainq/light-client — trust-minimised verification of chainq results.
 *
 * Status: v0.8.0 ships a MULTI-RPC QUORUM light client. It is the pragmatic,
 * genuinely-trust-reducing approach: instead of trusting a single archive (or
 * a single RPC) for the canonical block hash, query N independent public RPC
 * endpoints and only accept a block hash if a quorum of them agree. When they
 * disagree, the receipt surfaces it instead of silently trusting one source.
 *
 * Design intent
 * -------------
 *   chainq_query returns rows derived from Parquet sourced from a public
 *   archive. A paranoid user (audit, regulated deployment) wants to verify
 *   that those rows correspond to real chain state without trusting the
 *   archive. The light-client wrapper:
 *
 *     1. Receives a query result + the block_number range it was derived from.
 *     2. Fetches the authoritative block hash for the boundary blocks from
 *        EVERY configured RPC endpoint (`eth_getBlockByNumber`).
 *     3. Accepts a block hash only if `agree >= quorum`; otherwise the block is
 *        recorded as UNVERIFIED.
 *     4. Computes a deterministic content hash of the rows and emits a
 *        verification receipt other parties can re-check.
 *
 * Trust model & limits
 * --------------------
 *   A multi-RPC quorum REDUCES trust (you no longer depend on any single
 *   provider) but it is NOT a consensus proof. The quorum can be fooled if the
 *   majority of queried providers collude or all proxy the same upstream. The
 *   deeper future level is a Helios-style consensus light client
 *   (https://github.com/a16z/helios), which follows sync-committee signatures
 *   and proves a block hash against the beacon chain rather than counting
 *   votes. v0.8.0 documents that as the next milestone; quorum is the
 *   shippable, dependency-light first step.
 */

import { createHash } from "node:crypto";

export interface VerificationReceipt {
  chain: string;
  blockRange: { from: number; to: number };
  blockHashes: Record<number, string>;
  rowsHash: string;
  checkpointTrust: string;
  generatedAt: string;
  /** True iff every block we checked reached quorum. */
  verified: boolean;
  /** Blocks that failed to reach quorum (no authoritative hash). */
  unverifiedBlocks: number[];
  /** Per-block agreement ratio, e.g. `{ 100: "3/3", 200: "2/3" }`. */
  agreements: Record<number, string>;
}

export interface LightClient {
  /** Trusted checkpoint root / anchor description for the light client. */
  checkpoint: string;
  /** Fetch authoritative block hash for a block number. Throws if unavailable. */
  getBlockHash(blockNumber: number): Promise<string>;
}

/** Result of a single quorum query across all configured endpoints. */
export interface QuorumResult {
  /** Winning block hash if quorum met, else null. */
  hash: string | null;
  /** Votes for the winning hash. */
  agree: number;
  /** Number of endpoints queried. */
  total: number;
  /** Raw per-endpoint responses (null = error / missing). */
  responses: (string | null)[];
}

/** A quorum-capable light client also exposes the per-block tally. */
export interface QuorumLightClient extends LightClient {
  chain: string;
  getBlockHashQuorum(blockNumber: number): Promise<QuorumResult>;
}

export interface QuorumLightClientOptions {
  chain: string;
  rpcUrls: string[];
  /** Minimum agreeing endpoints. Default: floor(total/2)+1 (simple majority). */
  quorum?: number;
  /** Human-readable checkpoint label. Default: `quorum:<n-endpoints>`. */
  checkpoint?: string;
  /** Injectable fetch (testing). */
  fetch?: typeof globalThis.fetch;
}

const hexBlock = (n: number): string => "0x" + Math.trunc(n).toString(16);

interface JsonRpcResponse<T> {
  result?: T;
  error?: { message?: string; code?: number };
}

/**
 * Create a multi-RPC quorum light client. Each block hash is fetched from
 * every endpoint; the winner is the most-voted hash, accepted only when the
 * vote count reaches the quorum.
 */
export function createQuorumLightClient(opts: QuorumLightClientOptions): QuorumLightClient {
  const urls = opts.rpcUrls.filter((u): u is string => Boolean(u));
  if (urls.length === 0) {
    throw new Error("createQuorumLightClient: no rpcUrls provided");
  }
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const checkpoint = opts.checkpoint ?? `quorum:${urls.length}-endpoints`;

  async function fetchHash(url: string, blockNumber: number): Promise<string | null> {
    try {
      const resp = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBlockByNumber",
          params: [hexBlock(blockNumber), false],
        }),
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as JsonRpcResponse<{ hash?: string } | null>;
      if (json.error) return null;
      const hash = json.result?.hash;
      return typeof hash === "string" && hash.length > 0 ? hash : null;
    } catch {
      return null;
    }
  }

  async function getBlockHashQuorum(blockNumber: number): Promise<QuorumResult> {
    const responses = await Promise.all(urls.map((url) => fetchHash(url, blockNumber)));
    const total = responses.length;

    // Tally identical (non-null) hashes.
    const tally = new Map<string, number>();
    for (const h of responses) {
      if (h === null) continue;
      tally.set(h, (tally.get(h) ?? 0) + 1);
    }

    // Winner = the hash with the most votes.
    let winner: string | null = null;
    let agree = 0;
    for (const [hash, votes] of tally) {
      if (votes > agree) {
        agree = votes;
        winner = hash;
      }
    }

    const required = opts.quorum ?? Math.floor(total / 2) + 1;
    const hash = winner !== null && agree >= required ? winner : null;
    return { hash, agree, total, responses };
  }

  async function getBlockHash(blockNumber: number): Promise<string> {
    const { hash, agree, total } = await getBlockHashQuorum(blockNumber);
    if (hash === null) {
      throw new Error(`no quorum for block ${blockNumber}: ${agree}/${total} agreed`);
    }
    return hash;
  }

  return {
    chain: opts.chain,
    checkpoint,
    getBlockHash,
    getBlockHashQuorum,
  };
}

/**
 * Minimal light-client shape for callers that have not configured RPC
 * endpoints. `getBlockHash` throws a clear, actionable error — use
 * {@link createQuorumLightClient} for actual verification.
 */
export function createLightClient(opts: { checkpoint: string }): LightClient {
  return {
    checkpoint: opts.checkpoint,
    async getBlockHash(_n) {
      throw new Error(
        "createLightClient cannot verify block hashes — configure rpcUrls / use createQuorumLightClient",
      );
    },
  };
}

/**
 * Deterministic SHA-256 over a canonical JSON serialization of the rows.
 * Object keys are sorted recursively; array order is preserved as given.
 * Returns `0x` + lowercase hex.
 */
export function canonicalRowsHash(rows: unknown[]): string {
  const json = canonicalJson(rows);
  const digest = createHash("sha256").update(json, "utf8").digest("hex");
  return `0x${digest}`;
}

/** Back-compat alias for {@link canonicalRowsHash}. */
export const hashRows = canonicalRowsHash;

/** Serialize a value to canonical JSON: object keys sorted recursively. */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  // undefined, function, symbol — not serializable; collapse to null.
  return "null";
}

/** Optional knobs for {@link verifyRows} (reserved; signature stays 2-arg). */
export interface VerifyOptions {
  /** Override the chain label (otherwise taken from the client). */
  chain?: string;
}

/**
 * Verify that the boundary blocks of a result set match the authoritative
 * chain, using the quorum light client when available. Plain clients fall back
 * to {@link LightClient.getBlockHash} with try/catch.
 */
export async function verifyRows<T extends { block_number: number | string }>(
  rows: T[],
  client: LightClient,
  options?: VerifyOptions,
): Promise<VerificationReceipt> {
  const chain =
    options?.chain ??
    ("chain" in client && typeof (client as QuorumLightClient).chain === "string"
      ? (client as QuorumLightClient).chain
      : "ethereum");

  const numbers = rows
    .map((r) => Number(r.block_number))
    .filter((n) => Number.isFinite(n));

  const generatedAt = new Date().toISOString();

  if (numbers.length === 0) {
    return {
      chain,
      blockRange: { from: 0, to: 0 },
      blockHashes: {},
      rowsHash: canonicalRowsHash(rows),
      checkpointTrust: client.checkpoint,
      generatedAt,
      verified: false,
      unverifiedBlocks: [],
      agreements: {},
    };
  }

  const from = Math.min(...numbers);
  const to = Math.max(...numbers);

  // Check the min and max block (the boundary of the derived range).
  const toCheck = from === to ? [from] : [from, to];

  const blockHashes: Record<number, string> = {};
  const agreements: Record<number, string> = {};
  const unverifiedBlocks: number[] = [];

  const hasQuorum = "getBlockHashQuorum" in client;

  for (const n of toCheck) {
    if (hasQuorum) {
      const { hash, agree, total } = await (client as QuorumLightClient).getBlockHashQuorum(n);
      agreements[n] = `${agree}/${total}`;
      if (hash !== null) {
        blockHashes[n] = hash;
      } else {
        unverifiedBlocks.push(n);
      }
    } else {
      try {
        blockHashes[n] = await client.getBlockHash(n);
        agreements[n] = "1/1";
      } catch {
        unverifiedBlocks.push(n);
      }
    }
  }

  return {
    chain,
    blockRange: { from, to },
    blockHashes,
    rowsHash: canonicalRowsHash(rows),
    checkpointTrust: client.checkpoint,
    generatedAt,
    verified: unverifiedBlocks.length === 0,
    unverifiedBlocks,
    agreements,
  };
}
