/**
 * @chainq/engine-clickhouse — scaffold for the pluggable ClickHouse backend.
 *
 * This package defines the `EngineDriver` contract that the existing DuckDB
 * engine (in `packages/mcp-server/src/engine.ts`) and the upcoming ClickHouse
 * and Trino drivers will all satisfy. The implementation here is intentionally
 * empty — every method throws `not implemented` so consumers can wire the
 * package in now and we can fill it in for v0.5.0.
 *
 * Pre-alpha. The interface will break before v0.1.0.
 */

import type { QueryEstimate, QueryResult } from "@chainq/core";

export interface EngineDriverOptions {
  /** ClickHouse HTTP endpoint, e.g. https://ch.example.com:8443 */
  url: string;
  /** Username for HTTP basic auth or X-ClickHouse-User header. */
  user?: string;
  /** Password for HTTP basic auth, or X-ClickHouse-Key header. Read from env in production. */
  password?: string;
  /** Default database to query. */
  database?: string;
  /** Hard ceiling on rows returned per query. */
  defaultRowLimit?: number;
  /** Hard ceiling on wall-clock seconds. */
  defaultTimeoutSeconds?: number;
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

/**
 * Skeleton implementation. All methods throw `Error("not implemented: ...")`.
 * v0.5.0 will fill these in against the ClickHouse HTTP interface.
 */
export class ClickHouseEngine implements EngineDriver {
  constructor(private readonly opts: EngineDriverOptions) {}

  async start(): Promise<void> {
    throw new Error("not implemented: ClickHouseEngine.start (v0.5.0 target)");
  }

  async stop(): Promise<void> {
    throw new Error("not implemented: ClickHouseEngine.stop (v0.5.0 target)");
  }

  async estimate(_sql: string): Promise<QueryEstimate> {
    throw new Error("not implemented: ClickHouseEngine.estimate (v0.5.0 target)");
  }

  async query(
    _sql: string,
    _opts?: { maxRows?: number; timeoutSeconds?: number },
  ): Promise<QueryResult> {
    throw new Error("not implemented: ClickHouseEngine.query (v0.5.0 target)");
  }
}
