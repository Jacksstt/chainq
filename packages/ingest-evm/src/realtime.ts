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
  /**
   * Subsquid portal API key. Since 2026 the v2 archive requires one
   * (https://portal.sqd.dev); without it the worker lookup returns 403
   * `CREDENTIALS_INVALID`. Sent as `Authorization: Bearer <key>`.
   */
  apiKey?: string;
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
/**
 * Subsquid v2 archive protocol:
 *   1. GET `<archiveUrl>/<fromBlock>/worker` → returns the dynamic worker URL
 *      (load-balanced; can change between calls).
 *   2. POST query body to the worker URL → returns a batch of blocks.
 *   3. Advance `fromBlock` to the highest seen + 1; if more data, GOTO 1.
 *
 * We follow worker URLs each iteration because the archive can re-shard
 * mid-stream; sticking to one worker can return 404 on later pages.
 */
export async function* streamSubsquid(opts: SubsquidStreamOptions): AsyncGenerator<SubsquidBatch> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const authHeaders: Record<string, string> = opts.apiKey
    ? { authorization: `Bearer ${opts.apiKey}` }
    : {};
  let from = opts.fromBlock;
  while (true) {
    if (opts.toBlock != null && from > opts.toBlock) return;

    // 1. discover the worker that serves this block.
    const workerResp = await fetchImpl(`${opts.archiveUrl}/${from}/worker`, { headers: authHeaders });
    if (!workerResp.ok) {
      const text = await workerResp.text();
      throw new Error(`subsquid worker lookup failed at block ${from}: ${workerResp.status} ${text.slice(0, 200)}`);
    }
    const workerUrl = (await workerResp.text()).trim();
    if (!workerUrl) return; // No worker → head reached.

    // 2. POST the query body to the worker.
    const body = {
      fromBlock: from,
      ...(opts.toBlock != null ? { toBlock: opts.toBlock } : {}),
      ...(opts.maxBytes ? { maxBytes: opts.maxBytes } : {}),
      fields: defaultFields(),
      ...opts.request,
    };
    const resp = await fetchImpl(workerUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`subsquid stream failed at ${workerUrl}: ${resp.status} ${text.slice(0, 200)}`);
    }
    const batches = (await resp.json()) as SubsquidBatch[];
    if (batches.length === 0) return;

    let advancedTo = from;
    for (const batch of batches) {
      yield batch;
      advancedTo = Math.max(advancedTo, batch.header.number + 1);
    }
    // Defensive: if the worker returned batches but didn't advance the
    // cursor, bail to avoid an infinite loop.
    if (advancedTo <= from) return;
    from = advancedTo;
  }
}

function defaultFields() {
  // Match the Subsquid v2 archive schema. `trace` fields use a nested-dict
  // shape rather than the boolean shape used for block/log/transaction, so
  // we omit them here — the snapshot/watch use cases only need logs anyway.
  return {
    block: { number: true, hash: true, timestamp: true },
    log: { address: true, topics: true, data: true, transactionHash: true, logIndex: true },
    transaction: { hash: true, from: true, to: true, value: true, status: true, gasUsed: true },
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
