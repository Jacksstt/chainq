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
    const q = `%${query.toLowerCase()}%`;
    const reader = await cache.runAndReadAll(
      `SELECT id, sql, label, result_rows, elapsed_ms, created_at
       FROM query_cache
       WHERE LOWER(sql) LIKE ? OR LOWER(COALESCE(label, '')) LIKE ?
       ORDER BY created_at DESC LIMIT ?`,
      [q, q, BigInt(limit)],
    );
    return reader.getRowObjects().map((row) => ({
      id: String(row["id"]),
      sql: String(row["sql"]),
      label: row["label"] == null ? null : String(row["label"]),
      result_rows: Number(row["result_rows"]),
      elapsed_seconds: Number(row["elapsed_ms"]) / 1000,
      created_at: String(row["created_at"]),
    }));
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
