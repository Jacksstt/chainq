/**
 * Keyless EVM log ingestion over public JSON-RPC.
 *
 * Why this exists: Subsquid's v2 archive (the default snapshot source) moved
 * behind an API key in 2026 (see https://portal.sqd.dev), so the
 * "no RPC subscription required" promise needed a second, genuinely keyless
 * leg. Public RPC endpoints (publicnode, the official chain RPC, drpc) serve
 * `eth_getLogs` for free. The catch is each caps how much one call may
 * return: some refuse a multi-block range without an `address` filter
 * (`-32701`), others cap the result count (`-32005`). We cope with an
 * adaptive window that halves on a range/limit error and settles on the
 * largest size the endpoint tolerates, plus round-robin failover across a
 * list of endpoints.
 *
 * `eth_getLogs` does not carry block timestamps, so we resolve them with one
 * `eth_getBlockByNumber` per distinct block that produced a log.
 */

export interface RpcLog {
  blockNumber: number;
  /** Unix seconds. */
  blockTime: number;
  transactionHash: string;
  logIndex: number;
  address: string;
  topics: string[];
  data: string;
}

export interface FetchLogsViaRpcOptions {
  /** Failover list of JSON-RPC endpoints; the first reachable one is used. */
  rpcUrls: string[];
  /** Inclusive starting block. */
  fromBlock: number;
  /** Inclusive ending block. */
  toBlock: number;
  /** Optional contract-address filter (lets endpoints serve wider windows). */
  address?: string[];
  /** Optional topic0 filter. */
  topic0?: string[];
  /** Injectable fetch (testing). */
  fetch?: typeof globalThis.fetch;
  /** Safety cap on total logs; collection stops once exceeded. */
  maxLogs?: number;
  /** Per-window progress callback. */
  onProgress?: (info: { fromBlock: number; toBlock: number; logs: number; window: number }) => void;
}

/** Raised when an endpoint rejects a call for being too wide / returning too much. */
class RangeLimitError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "RangeLimitError";
    this.code = code;
  }
}

const hex = (n: number): string => "0x" + n.toString(16);

function isRangeLimit(message: string, code: number | undefined): boolean {
  if (code === -32701 || code === -32005) return true;
  return /specify an address|address in your request|block range|range is too|too large|too many|limit exceeded|exceeds|returned more than|more than .*results|response size|result set too large|query timeout|10000|payload too large|exceed maximum/i.test(
    message,
  );
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { message?: string; code?: number };
}

/**
 * Fetch raw EVM logs over public JSON-RPC, adaptively sizing the block
 * window to each endpoint's limits and failing over between endpoints.
 */
export async function fetchLogsViaRpc(opts: FetchLogsViaRpcOptions): Promise<RpcLog[]> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const urls = opts.rpcUrls.filter((u): u is string => Boolean(u));
  if (urls.length === 0) throw new Error("fetchLogsViaRpc: no rpcUrls provided");
  let cursor = 0; // index of the endpoint we currently prefer

  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < urls.length; attempt++) {
      const url = urls[(cursor + attempt) % urls.length];
      if (!url) continue;
      let json: JsonRpcResponse<T>;
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
        json = (await resp.json()) as JsonRpcResponse<T>;
      } catch (e) {
        lastErr = e;
        continue;
      }
      if (json.error) {
        const msg = json.error.message ?? "unknown rpc error";
        if (isRangeLimit(msg, json.error.code)) {
          // The windowing loop handles this by shrinking. Don't fail over —
          // sibling endpoints of the same class behave the same way.
          throw new RangeLimitError(`${method}: ${msg}`, json.error.code);
        }
        lastErr = new Error(`${method}: ${msg} (code ${json.error.code ?? "?"})`);
        continue; // try the next endpoint
      }
      cursor = (cursor + attempt) % urls.length; // stick to the one that worked
      return json.result as T;
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  // --- 1. Collect logs, shrinking the window on range/limit errors. --------
  const rawLogs: Array<Record<string, unknown>> = [];
  const filter: Record<string, unknown> = {};
  if (opts.address && opts.address.length > 0) filter["address"] = opts.address;
  if (opts.topic0 && opts.topic0.length > 0) filter["topics"] = [opts.topic0];

  let window = Math.max(1, opts.toBlock - opts.fromBlock + 1);
  let from = opts.fromBlock;
  while (from <= opts.toBlock) {
    const to = Math.min(from + window - 1, opts.toBlock);
    try {
      const logs = await rpc<Array<Record<string, unknown>>>("eth_getLogs", [
        { ...filter, fromBlock: hex(from), toBlock: hex(to) },
      ]);
      rawLogs.push(...logs);
      opts.onProgress?.({ fromBlock: from, toBlock: to, logs: logs.length, window });
      from = to + 1;
      if (opts.maxLogs && rawLogs.length >= opts.maxLogs) break;
    } catch (e) {
      if (e instanceof RangeLimitError && window > 1) {
        window = Math.max(1, Math.floor(window / 2));
        continue; // retry the same `from` with a smaller window
      }
      throw e;
    }
  }

  // --- 2. Resolve block timestamps (one call per distinct block). ----------
  const blockNumbers = [
    ...new Set(rawLogs.map((l) => Number.parseInt(String(l["blockNumber"]), 16))),
  ].sort((a, b) => a - b);
  const timestamps = new Map<number, number>();
  for (const bn of blockNumbers) {
    const block = await rpc<{ timestamp?: string } | null>("eth_getBlockByNumber", [hex(bn), false]);
    timestamps.set(bn, block?.timestamp ? Number.parseInt(block.timestamp, 16) : 0);
  }

  // --- 3. Normalise. -------------------------------------------------------
  return rawLogs.map((l): RpcLog => {
    const blockNumber = Number.parseInt(String(l["blockNumber"]), 16);
    const topics = Array.isArray(l["topics"]) ? (l["topics"] as string[]) : [];
    return {
      blockNumber,
      blockTime: timestamps.get(blockNumber) ?? 0,
      transactionHash: String(l["transactionHash"] ?? ""),
      logIndex: l["logIndex"] != null ? Number.parseInt(String(l["logIndex"]), 16) : 0,
      address: String(l["address"] ?? "").toLowerCase(),
      topics,
      data: String(l["data"] ?? ""),
    };
  });
}
