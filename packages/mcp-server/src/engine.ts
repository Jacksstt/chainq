/**
 * Thin DuckDB wrapper that holds the engine handle, runs queries, and caches
 * results in a persistent DuckDB file so the `recall` tool can search past
 * agent activity.
 */

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import type { QueryEstimate, QueryResult } from "@chainq/core";
import { CATALOG } from "./catalog.js";

export interface EngineOptions {
  /** Directory containing parquet files. */
  dataDir: string;
  /** Hard ceiling on rows returned. */
  defaultRowLimit?: number;
  /** Hard ceiling on wall-clock seconds. */
  defaultTimeoutSeconds?: number;
  /** Optional override for the cache database path. */
  cacheDbPath?: string;
}

export interface CacheEntry {
  id: string;
  sql: string;
  label: string | null;
  result_rows: number;
  elapsed_seconds: number;
  created_at: string;
  score?: number;
}

export class Engine {
  private conn: DuckDBConnection | null = null;
  private cacheConn: DuckDBConnection | null = null;
  private readonly opts: Required<EngineOptions>;

  constructor(opts: EngineOptions) {
    const dataDir = resolve(opts.dataDir);
    this.opts = {
      defaultRowLimit: 1000,
      defaultTimeoutSeconds: 30,
      cacheDbPath: join(dataDir, ".chainq-cache.duckdb"),
      ...opts,
      dataDir,
    };
  }

  async start(): Promise<void> {
    if (!existsSync(this.opts.dataDir)) mkdirSync(this.opts.dataDir, { recursive: true });

    const instance = await DuckDBInstance.create(":memory:");
    this.conn = await instance.connect();

    for (const table of CATALOG) {
      const file = join(this.opts.dataDir, `${table.name}.parquet`);
      if (!existsSync(file)) continue;
      const physical = table.name.replace(/\./g, "_");
      await this.conn.run(`CREATE VIEW "${physical}" AS SELECT * FROM read_parquet('${file}')`);
    }

    const cacheInstance = await DuckDBInstance.create(this.opts.cacheDbPath);
    this.cacheConn = await cacheInstance.connect();
    await this.cacheConn.run(`
      CREATE TABLE IF NOT EXISTS query_cache (
        id            VARCHAR PRIMARY KEY,
        sql           VARCHAR NOT NULL,
        label         VARCHAR,
        result_rows   BIGINT  NOT NULL,
        elapsed_ms    BIGINT  NOT NULL,
        result_json   VARCHAR NOT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async stop(): Promise<void> {
    if (this.conn) {
      this.conn.disconnectSync();
      this.conn = null;
    }
    if (this.cacheConn) {
      this.cacheConn.disconnectSync();
      this.cacheConn = null;
    }
  }

  private requireConn(): DuckDBConnection {
    if (!this.conn) throw new Error("Engine not started");
    return this.conn;
  }

  private requireCacheConn(): DuckDBConnection {
    if (!this.cacheConn) throw new Error("Engine not started");
    return this.cacheConn;
  }

  async estimate(sql: string): Promise<QueryEstimate> {
    const conn = this.requireConn();
    const warnings: string[] = [];

    let estimatedRows = -1;
    let estimatedSeconds = -1;
    try {
      const reader = await conn.runAndReadAll(`EXPLAIN ${sql}`);
      const plan = reader.getRowObjects().map((r) => Object.values(r).join(" ")).join("\n");
      const rowMatch = /(?:cardinality|estimated_rows|EC:)\s*[:=]?\s*(\d+)/i.exec(plan);
      if (rowMatch && rowMatch[1]) estimatedRows = Number(rowMatch[1]);
    } catch (err) {
      warnings.push(`EXPLAIN failed: ${(err as Error).message}`);
    }

    if (estimatedRows < 0) {
      warnings.push("Row estimate unavailable; conservative bound used.");
      estimatedRows = 100_000;
    }
    if (estimatedSeconds < 0) {
      estimatedSeconds = Math.max(0.1, estimatedRows / 1_000_000);
    }

    const estimatedBytes = estimatedRows * 200;
    const estimatedCredits = Math.max(1, Math.ceil(estimatedRows / 1000));

    return { estimatedRows, estimatedBytes, estimatedSeconds, estimatedCredits, warnings };
  }

  /**
   * Run a query, optionally caching the result for later `recall`.
   */
  async query(
    sql: string,
    opts: {
      maxRows?: number;
      timeoutSeconds?: number;
      cacheLabel?: string | null;
    } = {},
  ): Promise<QueryResult & { cacheId?: string }> {
    const conn = this.requireConn();
    const maxRows = opts.maxRows ?? this.opts.defaultRowLimit;
    const timeoutSeconds = opts.timeoutSeconds ?? this.opts.defaultTimeoutSeconds;

    const started = Date.now();
    const rewritten = rewriteCuratedNames(sql);
    const prepared = applyAutoLimit(rewritten, maxRows + 1);
    const reader = await runWithTimeout(
      conn.runAndReadAll(prepared),
      timeoutSeconds * 1000,
      `query exceeded ${timeoutSeconds}s timeout`,
    );
    const rows = reader.getRowObjects().map((row) => normalize(row) as Record<string, unknown>);
    const truncated = rows.length > maxRows;
    if (truncated) rows.length = maxRows;
    const elapsed = (Date.now() - started) / 1000;
    const columnTypes: Record<string, string> = {};
    for (const name of reader.columnNames()) columnTypes[name] = "?";

    const result: QueryResult & { cacheId?: string } = {
      rows,
      columnTypes,
      actualRows: rows.length,
      actualBytes: JSON.stringify(rows).length,
      actualSeconds: elapsed,
      truncated,
    };

    if (opts.cacheLabel !== null) {
      result.cacheId = await this.cacheResult(sql, opts.cacheLabel ?? null, rows, elapsed);
    }
    return result;
  }

  private async cacheResult(
    sql: string,
    label: string | null,
    rows: Record<string, unknown>[],
    elapsed: number,
  ): Promise<string> {
    const id = createHash("sha256").update(sql).digest("hex").slice(0, 16);
    const cache = this.requireCacheConn();
    await cache.run(
      `INSERT OR REPLACE INTO query_cache (id, sql, label, result_rows, elapsed_ms, result_json) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, sql, label, BigInt(rows.length), BigInt(Math.round(elapsed * 1000)), JSON.stringify(rows.slice(0, 50))],
    );
    return id;
  }

  async recall(query: string, limit = 10): Promise<CacheEntry[]> {
    const cache = this.requireCacheConn();
    // Pull a bounded slice of the cache and rank it in-process with BM25 so we
    // can score sql + label tokens jointly instead of running raw LIKE.
    const reader = await cache.runAndReadAll(
      `SELECT id, sql, label, result_rows, elapsed_ms, created_at
       FROM query_cache
       ORDER BY created_at DESC
       LIMIT 5000`,
    );
    const rows = reader.getRowObjects().map((row) => ({
      id: String(row["id"]),
      sql: String(row["sql"]),
      label: row["label"] == null ? null : String(row["label"]),
      result_rows: Number(row["result_rows"]),
      elapsed_seconds: Number(row["elapsed_ms"]) / 1000,
      created_at: String(row["created_at"]),
    }));

    if (rows.length === 0) return [];

    const queryTokens = tokenize(query);
    const docTokens = rows.map((r) => tokenize(`${r.sql} ${r.label ?? ""}`));

    // If the query produced no tokens, fall through to the recency fallback.
    if (queryTokens.length > 0) {
      const N = rows.length;
      const docLens = docTokens.map((t) => t.length);
      const avgdl = docLens.reduce((a, b) => a + b, 0) / Math.max(1, N);

      // Document frequency for each unique query term.
      const df = new Map<string, number>();
      const uniqQueryTerms = Array.from(new Set(queryTokens));
      for (const term of uniqQueryTerms) {
        let count = 0;
        for (const tokens of docTokens) {
          if (tokens.includes(term)) count++;
        }
        df.set(term, count);
      }

      const k1 = 1.5;
      const b = 0.75;
      const scored = rows.map((row, i) => {
        const tokens = docTokens[i] ?? [];
        const dl = docLens[i] ?? 0;
        const tf = new Map<string, number>();
        for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
        let score = 0;
        for (const term of uniqQueryTerms) {
          const f = tf.get(term) ?? 0;
          if (f === 0) continue;
          const dfi = df.get(term) ?? 0;
          const idf = Math.log((N - dfi + 0.5) / (dfi + 0.5) + 1);
          const denom = f + k1 * (1 - b + (b * dl) / Math.max(1, avgdl));
          score += idf * ((f * (k1 + 1)) / denom);
        }
        return { ...row, score };
      });

      const hits = scored.filter((r) => r.score > 0);
      if (hits.length > 0) {
        hits.sort((a, b) => b.score - a.score);
        return hits.slice(0, limit);
      }
    }

    // Fallback: no token matches (or empty query). Return recent rows; the
    // input was already sorted by created_at DESC.
    return rows.slice(0, limit).map((r) => ({ ...r, score: 0 }));
  }

  async recallById(id: string): Promise<(CacheEntry & { result_preview: unknown[] }) | null> {
    const cache = this.requireCacheConn();
    const reader = await cache.runAndReadAll(
      `SELECT id, sql, label, result_rows, elapsed_ms, created_at, result_json
       FROM query_cache WHERE id = ?`,
      [id],
    );
    const row = reader.getRowObjects()[0];
    if (!row) return null;
    return {
      id: String(row["id"]),
      sql: String(row["sql"]),
      label: row["label"] == null ? null : String(row["label"]),
      result_rows: Number(row["result_rows"]),
      elapsed_seconds: Number(row["elapsed_ms"]) / 1000,
      created_at: String(row["created_at"]),
      result_preview: JSON.parse(String(row["result_json"])) as unknown[],
    };
  }
}

export function normalize(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    if (isDuckDbDecimal(value)) return decimalToString(value);
    if (isDuckDbTimestamp(value)) return timestampToIso(value);
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}

interface DuckDbDecimal {
  width: number;
  scale: number;
  value: bigint | string | number;
}

function isDuckDbDecimal(v: object): v is DuckDbDecimal {
  const o = v as Record<string, unknown>;
  if (!("width" in o) || !("scale" in o) || !("value" in o)) return false;
  if (typeof o.width !== "number" || typeof o.scale !== "number") return false;
  const t = typeof o.value;
  return t === "bigint" || t === "string" || t === "number";
}

/**
 * Convert a DuckDB DECIMAL value to a precision-preserving decimal string.
 *   { width: 21, scale: 1, value: "15" } → "1.5"
 *   { width: 23, scale: 2, value: "-1234" } → "-12.34"
 *   { width: 38, scale: 18, value: "1" } → "0.000000000000000001"
 */
export function decimalToString(d: DuckDbDecimal): string {
  const raw = typeof d.value === "bigint" ? d.value.toString() : String(d.value);
  const neg = raw.startsWith("-");
  const digits = neg ? raw.slice(1) : raw;
  const scale = Math.max(0, d.scale | 0);
  let body: string;
  if (scale === 0) {
    body = digits;
  } else if (digits.length <= scale) {
    const padded = digits.padStart(scale + 1, "0");
    body = padded.slice(0, -scale) + "." + padded.slice(-scale);
  } else {
    body = digits.slice(0, -scale) + "." + digits.slice(-scale);
  }
  return neg ? "-" + body : body;
}

interface DuckDbTimestamp {
  micros: bigint | string | number;
}

function isDuckDbTimestamp(v: object): v is DuckDbTimestamp {
  const o = v as Record<string, unknown>;
  if (!("micros" in o)) return false;
  // Single-key envelope so we don't accidentally match arbitrary user objects.
  if (Object.keys(o).length !== 1) return false;
  const t = typeof o.micros;
  return t === "bigint" || t === "string" || t === "number";
}

/**
 * Convert a DuckDB TIMESTAMP value (microseconds since Unix epoch) to an ISO
 * 8601 string. Preserves microsecond precision when the value has any: a
 * timestamp landing on a whole millisecond renders as `2026-01-01T00:00:00Z`
 * (Date#toISOString form), and a sub-millisecond value renders with six
 * fractional digits, e.g. `2026-01-01T00:00:00.123456Z`.
 */
export function timestampToIso(v: DuckDbTimestamp): string {
  const m = typeof v.micros === "bigint" ? v.micros : BigInt(String(v.micros));
  const totalMs = m / 1000n;
  const subMs = Number(m - totalMs * 1000n); // microsecond remainder, 0..999
  const ms = Number(totalMs);
  const iso = new Date(ms).toISOString();
  if (subMs === 0) return iso;
  const microStr = subMs.toString().padStart(3, "0");
  return iso.replace(/\.(\d{3})Z$/, (_, milli: string) => `.${milli}${microStr}Z`);
}

/**
 * Rewrite curated logical names like "dex.trades" / dex.trades into the
 * underscore-form physical view name (dex_trades). Allows callers to write
 * either form in SQL.
 */
export function rewriteCuratedNames(sql: string): string {
  let out = sql;
  for (const table of CATALOG) {
    const physical = table.name.replace(/\./g, "_");
    if (physical === table.name) continue;
    // Quoted form: "dex.trades" → dex_trades
    out = out.split(`"${table.name}"`).join(physical);
    // Unquoted dotted form, used only when not adjacent to identifier chars
    // (so we don't touch things like sometable.dex.trades).
    const escaped = table.name.replace(/[.]/g, "\\.");
    const re = new RegExp(`(?<![\\w."'])${escaped}(?![\\w."'])`, "g");
    out = out.replace(re, physical);
  }
  return out;
}

/**
 * Append `LIMIT N` to a SQL statement only when it is a plain SELECT/WITH that
 * does not already carry an outer LIMIT. Leaves PRAGMA, DDL, EXPLAIN, SHOW,
 * CALL, COPY, and statements with existing LIMIT untouched.
 */
export function applyAutoLimit(sql: string, limit: number): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  // Detect the first significant token, skipping line and block comments.
  const head = trimmed.replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, "");
  if (!/^(?:select|with)\b/i.test(head)) {
    return trimmed;
  }
  if (/\blimit\s+\d+(?:\s+offset\s+\d+)?\s*$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}\nLIMIT ${limit}`;
}

/**
 * Lowercase word tokenizer used by `recall`'s BM25 ranking. Splits on the
 * inverse of `[a-z0-9_]+` and drops tokens shorter than two characters so
 * single-letter SQL aliases don't bloat the term space.
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const matches = lower.match(/[a-z0-9_]+/g) ?? [];
  return matches.filter((t) => t.length >= 2);
}

async function runWithTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
