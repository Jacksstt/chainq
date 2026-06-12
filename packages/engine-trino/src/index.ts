/**
 * @chainq/engine-trino — Trino / Starburst driver for chainq.
 *
 * Implements the Trino REST protocol (the "client protocol"): a query is
 * submitted by POSTing the SQL text to `<url>/v1/statement`, and the result
 * is streamed across a chain of pages each linked by a `nextUri`. We follow
 * that chain with GETs until no `nextUri` remains, accumulating the column
 * metadata (seen once, on the first page that carries it) and the row data
 * (arrays of cell values, positionally aligned with the columns).
 *
 * The driver satisfies the same `EngineDriver` contract as
 * `@chainq/engine-clickhouse` (EngineDriver from @chainq/core) so the MCP
 * server can switch backends with a single config flag.
 *
 * Why Trino: it is the engine Dune Analytics runs under the hood
 * ("DuneSQL"). Pointing chainq at the same engine — running on your own
 * Iceberg-on-S3 store — gives the largest possible cross-portability of
 * dbt models between the two systems.
 */

import type { QueryEstimate, QueryResult } from "@chainq/core";

export interface TrinoEngineOptions {
  /** Trino coordinator URL, e.g. `https://trino.example.com:8443` */
  url: string;
  /** Catalog (Iceberg / Hive / Memory, etc.). */
  catalog?: string;
  /** Default schema for unqualified table names. */
  schema?: string;
  /** Username for basic auth or the `X-Trino-User` header. */
  user?: string;
  /** Optional token / password for basic auth. Read from env in production. */
  password?: string;
  /** Hard ceiling on rows returned per query. */
  defaultRowLimit?: number;
  /** Hard ceiling on wall-clock seconds. */
  defaultTimeoutSeconds?: number;
  /** Inject fetch (testing / record-replay). */
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

/** A single column descriptor as returned by Trino in the `columns` field. */
interface TrinoColumn {
  name: string;
  type: string;
}

/** Subset of the Trino `stats` object we read for cost accounting. */
interface TrinoStats {
  elapsedTimeMillis?: number;
  processedBytes?: number;
}

/**
 * Subset of a Trino statement-result page. Every page carries `id` and
 * (usually) `nextUri`; `columns` appears once the query has been analyzed,
 * `data` appears once rows are available, and `error` appears on failure.
 */
interface TrinoResultPage {
  id?: string;
  nextUri?: string;
  columns?: TrinoColumn[];
  data?: unknown[][];
  stats?: TrinoStats;
  error?: {
    message?: string;
    errorName?: string;
    errorCode?: number;
  };
}

/**
 * Trino driver. Submits SQL via the REST statement protocol and drains the
 * `nextUri` page chain, mirroring the shape of ClickHouseEngine in
 * @chainq/engine-clickhouse so the chainq MCP server can swap drivers via a
 * single import.
 */
export class TrinoEngine implements EngineDriver {
  constructor(private readonly opts: TrinoEngineOptions) {}

  /** Resolve the injected fetch, falling back to the global one. */
  private get fetchImpl(): typeof globalThis.fetch {
    return this.opts.fetch ?? globalThis.fetch;
  }

  /** Headers common to the initial POST. Trino requires X-Trino-User. */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "X-Trino-User": this.opts.user ?? "chainq",
      "Content-Type": "text/plain",
    };
    if (this.opts.catalog !== undefined) {
      headers["X-Trino-Catalog"] = this.opts.catalog;
    }
    if (this.opts.schema !== undefined) {
      headers["X-Trino-Schema"] = this.opts.schema;
    }
    return headers;
  }

  async start(): Promise<void> {
    // Verify connectivity by running a trivial query and draining it.
    await this.query("SELECT 1");
  }

  async stop(): Promise<void> {
    // No persistent connection / pool to tear down for the REST protocol.
  }

  async estimate(_sql: string): Promise<QueryEstimate> {
    // Trino has no cheap "dry-run with estimate" endpoint comparable to
    // ClickHouse's EXPLAIN ESTIMATE, so we return a heuristic placeholder.
    // Credits are not metered for self-hosted Trino, so estimatedCredits=0.
    return {
      estimatedRows: 0,
      estimatedBytes: 0,
      estimatedSeconds: 0,
      estimatedCredits: 0,
      warnings: [
        "Trino estimate is a heuristic placeholder; no server round trip was made. " +
          "Actual cost is only known after the query runs.",
      ],
    };
  }

  async query(
    sql: string,
    opts?: { maxRows?: number; timeoutSeconds?: number },
  ): Promise<QueryResult> {
    const maxRows = opts?.maxRows ?? this.opts.defaultRowLimit;

    // 1. Submit the statement.
    const submitUrl = `${this.opts.url.replace(/\/+$/, "")}/v1/statement`;
    let page = await this.fetchPage(submitUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: sql,
    });

    // 2. Drain the page chain, accumulating columns and rows.
    let columns: TrinoColumn[] | undefined;
    const rows: Record<string, unknown>[] = [];
    let lastStats: TrinoStats | undefined;
    let truncated = false;

    for (;;) {
      if (page.error) {
        const name = page.error.errorName ? ` [${page.error.errorName}]` : "";
        const msg = page.error.message ?? "unknown Trino error";
        throw new Error(`Trino query failed${name}: ${msg}`);
      }

      if (columns === undefined && page.columns !== undefined) {
        columns = page.columns;
      }
      if (page.stats !== undefined) {
        lastStats = page.stats;
      }

      if (page.data !== undefined && page.data.length > 0) {
        // We can only key rows by column name once columns are known. Trino
        // always sends `columns` on (or before) the first page carrying data.
        if (columns === undefined) {
          throw new Error(
            "Trino returned data before any column metadata; cannot key rows",
          );
        }
        for (const cells of page.data) {
          if (maxRows !== undefined && rows.length >= maxRows) {
            truncated = true;
            break;
          }
          rows.push(toRecord(columns, cells));
        }
      }

      // Stop following the chain once the row ceiling is hit, or when there
      // is no further page to fetch.
      if (truncated || page.nextUri === undefined) {
        break;
      }

      page = await this.fetchPage(page.nextUri, {
        method: "GET",
        headers: { "X-Trino-User": this.opts.user ?? "chainq" },
      });
    }

    const columnTypes: Record<string, string> = {};
    for (const col of columns ?? []) {
      columnTypes[col.name] = col.type;
    }

    return {
      rows,
      columnTypes,
      actualRows: rows.length,
      actualBytes: lastStats?.processedBytes ?? 0,
      actualSeconds:
        lastStats?.elapsedTimeMillis !== undefined
          ? lastStats.elapsedTimeMillis / 1000
          : 0,
      truncated,
    };
  }

  /** Fetch one statement-result page and parse its JSON body. */
  private async fetchPage(
    url: string,
    init: RequestInit,
  ): Promise<TrinoResultPage> {
    const res = await this.fetchImpl(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Trino HTTP ${res.status} ${res.statusText} for ${url}${
          text ? `: ${text}` : ""
        }`,
      );
    }
    return (await res.json()) as TrinoResultPage;
  }
}

/**
 * Convert a positional Trino row (array of cells) into a record keyed by
 * column name. `noUncheckedIndexedAccess` makes `cells[i]` possibly
 * undefined, which is the correct semantics for a missing trailing cell.
 */
function toRecord(
  columns: TrinoColumn[],
  cells: unknown[],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col === undefined) continue;
    row[col.name] = cells[i];
  }
  return row;
}
