/**
 * @chainq/engine-trino — Trino / Starburst driver scaffold for chainq.
 *
 * Status: skeleton. All methods throw. The full implementation is the
 * v0.5.0 target alongside the ClickHouse driver. The TypeScript interface
 * matches `@chainq/engine-clickhouse` (EngineDriver from @chainq/core)
 * so the MCP server can switch backends with a single config flag once
 * either driver is finished.
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

/**
 * Trino skeleton. Mirrors the shape of ClickHouseEngine in
 * @chainq/engine-clickhouse so the chainq MCP server can swap drivers
 * via a single import once implemented.
 */
export class TrinoEngine implements EngineDriver {
  constructor(private readonly opts: TrinoEngineOptions) {}

  async start(): Promise<void> {
    throw new Error("not implemented: TrinoEngine.start (v0.5.0 target)");
  }

  async stop(): Promise<void> {
    throw new Error("not implemented: TrinoEngine.stop (v0.5.0 target)");
  }

  async estimate(_sql: string): Promise<QueryEstimate> {
    throw new Error("not implemented: TrinoEngine.estimate (v0.5.0 target)");
  }

  async query(
    _sql: string,
    _opts?: { maxRows?: number; timeoutSeconds?: number },
  ): Promise<QueryResult> {
    throw new Error("not implemented: TrinoEngine.query (v0.5.0 target)");
  }
}
