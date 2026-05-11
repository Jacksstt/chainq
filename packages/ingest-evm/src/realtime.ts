/**
 * Realtime EVM ingest backed by a Subsquid archive.
 *
 * Subsquid exposes a binary archive that streams blocks / logs / traces faster
 * than RPC pagination, with reorg handling baked in. We hit the archive's
 * REST `/stream` endpoint directly so this package doesn't need the full
 * `@subsquid/evm-processor` heaviness.
 *
 * For v0.0.x we expose the streaming primitive. v0.1.0 will add a checkpointed
 * writer that drops Parquet partitions into the chainq data dir.
 */

export interface SubsquidStreamOptions {
  /** Archive base URL, e.g. https://v2.archive.subsquid.io/network/base-mainnet. */
  archiveUrl: string;
  /** Inclusive starting block. */
  fromBlock: number;
  /** Inclusive ending block; omit to follow the head. */
  toBlock?: number;
  /** Which datasets to stream. */
  request: SubsquidRequest;
  /** Optional fetch override (testing). */
  fetch?: typeof globalThis.fetch;
  /** Max payload bytes per page (server-side hint). */
  maxBytes?: number;
}

export interface SubsquidRequest {
  logs?: { address?: string[]; topic0?: string[] }[];
  transactions?: { to?: string[]; from?: string[] }[];
  traces?: { type?: string[] }[];
}

export interface SubsquidBatch {
  header: { number: number; hash: string; timestamp: number };
  logs?: Array<Record<string, unknown>>;
  transactions?: Array<Record<string, unknown>>;
  traces?: Array<Record<string, unknown>>;
}

/**
 * Async iterator over Subsquid stream batches. Caller is responsible for
 * checkpointing the last seen block.
 */
export async function* streamSubsquid(opts: SubsquidStreamOptions): AsyncGenerator<SubsquidBatch> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  let from = opts.fromBlock;
  while (true) {
    const body = {
      type: "evm",
      fromBlock: from,
      ...(opts.toBlock ? { toBlock: opts.toBlock } : {}),
      ...(opts.maxBytes ? { maxBytes: opts.maxBytes } : {}),
      fields: defaultFields(),
      ...opts.request,
    };
    const resp = await fetchImpl(`${opts.archiveUrl}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`subsquid stream failed: ${resp.status} ${text.slice(0, 200)}`);
    }
    const batches = (await resp.json()) as SubsquidBatch[];
    if (batches.length === 0) return;
    for (const batch of batches) {
      yield batch;
      from = Math.max(from, batch.header.number + 1);
    }
    if (opts.toBlock && from > opts.toBlock) return;
  }
}

function defaultFields() {
  return {
    block: { number: true, hash: true, timestamp: true },
    log: { address: true, topics: true, data: true, transactionHash: true, logIndex: true },
    transaction: { hash: true, from: true, to: true, value: true, status: true, gasUsed: true },
    trace: { type: true, action: true, result: true },
  };
}

/**
 * Convenience: drain a stream into an array. Intended for tests / small ranges.
 */
export async function collectStream(opts: SubsquidStreamOptions, maxBatches = 10): Promise<SubsquidBatch[]> {
  const out: SubsquidBatch[] = [];
  for await (const batch of streamSubsquid(opts)) {
    out.push(batch);
    if (out.length >= maxBatches) break;
  }
  return out;
}
