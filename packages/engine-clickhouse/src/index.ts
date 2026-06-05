/**
 * @chainq/engine-clickhouse — pluggable ClickHouse backend driver.
 *
 * This package defines the `EngineDriver` contract that the existing DuckDB
 * engine (in `packages/mcp-server/src/engine.ts`) and the upcoming Trino driver
 * will all satisfy. `ClickHouseEngine` talks to ClickHouse over its HTTP
 * interface so it works against ClickHouse Cloud, self-hosted, and chDB-HTTP
 * without a native client dependency.
 *
 * Pre-alpha. The interface will break before v0.1.0.
 */

import type { QueryEstimate, QueryResult } from "@chainq/core";

export interface EngineDriverOptions {
  /** ClickHouse HTTP endpoint, e.g. https://ch.example.com:8443 */
  url: string;
  /** Username for the X-ClickHouse-User header. */
  user?: string;
  /** Password for the X-ClickHouse-Key header. Read from env in production. */
  password?: string;
  /** Default database to query. */
  database?: string;
  /** Hard ceiling on rows returned per query. */
  defaultRowLimit?: number;
  /** Hard ceiling on wall-clock seconds. */
  defaultTimeoutSeconds?: number;
  /**
   * Injectable fetch implementation. Defaults to `globalThis.fetch`. Supplying
   * a mock here makes the driver testable offline.
   */
  fetch?: typeof globalThis.fetch;
}

export interface EngineDriver {
  start(): Promise<void>;
  stop(): Promise<void>;
  estimate(sql: string): Promise<QueryEstimate>;
  query(
    sql: string,
    opts?: { maxRows?: number; timeoutSeconds?: number },
  ): Promise<QueryResult>;
}

/** Default row cap when neither the call nor the options specify one. */
const DEFAULT_ROW_LIMIT = 10_000;
/** Default query timeout (seconds) when neither call nor options specify one. */
const DEFAULT_TIMEOUT_SECONDS = 30;

/**
 * Shape of the JSON document ClickHouse returns for `FORMAT JSON`. Only the
 * fields we consume are modelled here; ClickHouse may emit more.
 */
interface ClickHouseJsonResponse {
  meta?: Array<{ name: string; type: string }>;
  data?: Array<Record<string, unknown>>;
  rows?: number;
  statistics?: {
    elapsed?: number;
    rows_read?: number;
    bytes_read?: number;
  };
}

/**
 * ClickHouse HTTP driver. Each public method builds a single POST against the
 * configured endpoint, except `estimate`, which is an offline heuristic so it
 * costs nothing and never blocks on a server round trip.
 */
export class ClickHouseEngine implements EngineDriver {
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(private readonly opts: EngineDriverOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
  }

  /**
   * Verify connectivity by issuing `SELECT 1`. Throws a clear error if the
   * endpoint is unreachable or returns a non-2xx status.
   */
  async start(): Promise<void> {
    let res: Response;
    try {
      res = await this.post("SELECT 1");
    } catch (cause) {
      throw new Error(
        `ClickHouseEngine.start: failed to reach ${this.opts.url} — ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { cause },
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `ClickHouseEngine.start: connectivity check (SELECT 1) failed with HTTP ${res.status} ${res.statusText}${
          body ? ` — ${body}` : ""
        }`,
      );
    }
  }

  /** No persistent connection to tear down for the HTTP interface. */
  async stop(): Promise<void> {
    // no-op: each request is a stateless HTTP POST.
  }

  /**
   * Cheap offline heuristic — no server round trip. ClickHouse does not expose
   * a generic, reliable pre-execution cost estimate over HTTP, so we return
   * modest fixed estimates and flag them as heuristic via a warning. Callers
   * that need real numbers should run the query and read `actual*` fields.
   */
  async estimate(_sql: string): Promise<QueryEstimate> {
    return {
      estimatedRows: 1_000,
      estimatedBytes: 64_000,
      estimatedSeconds: 1,
      estimatedCredits: 0,
      warnings: [
        "ClickHouse estimation is heuristic (no server round trip); actual cost is only known after query() runs.",
      ],
    };
  }

  /**
   * Execute `sql` and return rows, column types, and ClickHouse statistics.
   * The result is row-capped client-side: ClickHouse may return more rows than
   * `maxRows`, so we slice `data` and set `truncated` accordingly.
   */
  async query(
    sql: string,
    opts?: { maxRows?: number; timeoutSeconds?: number },
  ): Promise<QueryResult> {
    const maxRows = opts?.maxRows ?? this.opts.defaultRowLimit ?? DEFAULT_ROW_LIMIT;
    const timeoutSeconds =
      opts?.timeoutSeconds ??
      this.opts.defaultTimeoutSeconds ??
      DEFAULT_TIMEOUT_SECONDS;

    const res = await this.post(sql, { timeoutSeconds });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `ClickHouseEngine.query: HTTP ${res.status} ${res.statusText}${
          body ? ` — ${body}` : ""
        }`,
      );
    }

    let parsed: ClickHouseJsonResponse;
    try {
      parsed = (await res.json()) as ClickHouseJsonResponse;
    } catch (cause) {
      throw new Error(
        `ClickHouseEngine.query: failed to parse ClickHouse JSON response — ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { cause },
      );
    }

    const meta = parsed.meta ?? [];
    const data = parsed.data ?? [];

    const columnTypes: Record<string, string> = {};
    for (const col of meta) {
      columnTypes[col.name] = col.type;
    }

    const truncated = data.length > maxRows;
    const rows = truncated ? data.slice(0, maxRows) : data;

    const stats = parsed.statistics ?? {};
    const actualBytes = stats.bytes_read ?? 0;
    const actualSeconds = stats.elapsed ?? 0;

    return {
      rows,
      columnTypes,
      actualRows: rows.length,
      actualBytes,
      actualSeconds,
      truncated,
    };
  }

  /**
   * POST `sql` (with `FORMAT JSON` appended) to the ClickHouse HTTP endpoint.
   * Auth goes through `X-ClickHouse-User` / `X-ClickHouse-Key` headers; the
   * database and execution timeout go through query-string params.
   */
  private async post(
    sql: string,
    opts?: { timeoutSeconds?: number },
  ): Promise<Response> {
    const target = new URL(this.opts.url);
    if (this.opts.database !== undefined) {
      target.searchParams.set("database", this.opts.database);
    }
    if (opts?.timeoutSeconds !== undefined) {
      target.searchParams.set(
        "max_execution_time",
        String(opts.timeoutSeconds),
      );
    }

    const headers: Record<string, string> = {
      "content-type": "text/plain; charset=utf-8",
    };
    if (this.opts.user !== undefined) {
      headers["X-ClickHouse-User"] = this.opts.user;
    }
    if (this.opts.password !== undefined) {
      headers["X-ClickHouse-Key"] = this.opts.password;
    }

    const body = `${sql}\nFORMAT JSON`;

    return this.fetchFn(target.toString(), {
      method: "POST",
      headers,
      body,
    });
  }
}
