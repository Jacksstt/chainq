/**
 * @chainq/light-client — trust-minimised verification of chainq results.
 *
 * Status: research / skeleton. v0.0.x ships interfaces only. The actual
 * verification will integrate Helios (https://github.com/a16z/helios) once
 * its WASM bindings are stable enough for our use case.
 *
 * Design intent
 * -------------
 *   chainq_query returns rows derived from Parquet sourced from a public
 *   archive. A paranoid user (audit, regulated deployment) wants to verify
 *   that those rows match the actual chain state without trusting the
 *   archive. The light-client wrapper:
 *
 *     1. Receives a query result + the block_number range it was derived from.
 *     2. Uses a Helios light client to fetch authoritative block hashes for
 *        those numbers (light client follows committee signatures, not full
 *        consensus, but proves data is what miners signed).
 *     3. Computes a content hash of the rows and emits a verification
 *        receipt that other parties can check.
 *
 * Why this matters
 * ----------------
 *   Combined with @chainq/snapshot (no RPC required) and a Helios checkpoint,
 *   chainq becomes the only OSS analytics stack where a user can prove
 *   "this aggregation was computed from canonical chain data" without
 *   running a full archive node.
 */

export interface VerificationReceipt {
  chain: string;
  blockRange: { from: number; to: number };
  blockHashes: Record<number, string>;
  rowsHash: string;
  checkpointTrust: string;
  generatedAt: string;
}

export interface LightClient {
  /** Trusted checkpoint root used to anchor the light client. */
  checkpoint: string;
  /** Fetch authoritative block hash for a block number. */
  getBlockHash(blockNumber: number): Promise<string>;
}

/**
 * Placeholder factory. v0.1+ wires this to Helios WASM.
 */
export function createLightClient(_opts: { checkpoint: string }): LightClient {
  return {
    checkpoint: _opts.checkpoint,
    async getBlockHash(_n) {
      throw new Error("not implemented — Helios WASM wiring lands in v0.2.0");
    },
  };
}

export async function verifyRows<T extends { block_number: number | string }>(
  rows: T[],
  client: LightClient,
): Promise<VerificationReceipt> {
  const numbers = rows.map((r) => Number(r.block_number)).filter((n) => Number.isFinite(n));
  if (numbers.length === 0) {
    return {
      chain: "unknown",
      blockRange: { from: 0, to: 0 },
      blockHashes: {},
      rowsHash: "",
      checkpointTrust: client.checkpoint,
      generatedAt: new Date().toISOString(),
    };
  }
  const from = Math.min(...numbers);
  const to = Math.max(...numbers);
  const blockHashes: Record<number, string> = {};
  for (const n of [from, to]) {
    blockHashes[n] = await client.getBlockHash(n);
  }
  return {
    chain: "ethereum",
    blockRange: { from, to },
    blockHashes,
    rowsHash: hashRows(rows),
    checkpointTrust: client.checkpoint,
    generatedAt: new Date().toISOString(),
  };
}

function hashRows(rows: unknown[]): string {
  // Placeholder content-hash. Real implementation will use keccak256 or
  // SHA-256 with a deterministic JSON canonicalization.
  const json = JSON.stringify(rows);
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return `0x${(h >>> 0).toString(16).padStart(8, "0")}`;
}
