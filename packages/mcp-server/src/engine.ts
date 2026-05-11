/**
 * Thin DuckDB wrapper that holds the engine handle and runs queries.
 *
 * v0.0.x scope: read Parquet files under the configured data dir as view
 * names matching the catalog. Real implementation will use dbt-built tables.
 */

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { QueryEstimate, QueryResult } from "@chainq/core";
import { CATALOG } from "./catalog.js";

export interface EngineOptions {
  /** Directory containing parquet files. */
  dataDir: string;
  /** Hard ceiling on rows returned. */
  defaultRowLimit?: number;
  /** Hard ceiling on wall-clock seconds. */
  defaultTimeoutSeconds?: number;
}

export class Engine {
  private conn: DuckDBConnection | null = null;
  private readonly opts: Required<EngineOptions>;

  constructor(opts: EngineOptions) {
    this.opts = {
      defaultRowLimit: 1000,
      defaultTimeoutSeconds: 30,
      ...opts,
    };
  }

  async start(): Promise<void> {
    const instance = await DuckDBInstance.create(":memory:");
    this.conn = await instance.connect();

    // Register each catalog table as a view over the matching Parquet path
    // (if it exists). Tables without data are still describable, just empty.
    for (const table of CATALOG) {
      const file = join(this.opts.dataDir, `${table.name}.parquet`);
      if (!existsSync(file)) continue;
      const view = table.name.replace(/\./g, "_");
      await this.conn.run(`CREATE VIEW "${table.name}" AS SELECT * FROM read_parquet('${file}')`);
      // also create a flat alias so cross-schema joins remain ergonomic
      await this.conn.run(`CREATE VIEW "${view}" AS SELECT * FROM "${table.name}"`);
    }
  }

  async stop(): Promise<void> {
    if (this.conn) {
      this.conn.disconnectSync();
      this.conn = null;
    }
  }

  private requireConn(): DuckDBConnection {
    if (!this.conn) throw new Error("Engine not started");
    return this.conn;
  }

  async estimate(sql: string): Promise<QueryEstimate> {
    const conn = this.requireConn();
    const warnings: string[] = [];

    let estimatedRows = -1;
    let estimatedSeconds = -1;
    try {
      const reader = await conn.runAndReadAll(`EXPLAIN ANALYZE ${sql} LIMIT 0`);
      const plan = reader.getRowObjects().map((r) => Object.values(r).join(" ")).join("\n");
      const rowMatch = /(?:cardinality|estimated_rows)\s*[:=]\s*(\d+)/i.exec(plan);
      if (rowMatch && rowMatch[1]) estimatedRows = Number(rowMatch[1]);
    } catch (err) {
      warnings.push(`EXPLAIN failed: ${(err as Error).message}`);
    }

    if (estimatedRows < 0) {
      warnings.push("Row estimate unavailable; conservative bound used.");
      estimatedRows = 100000;
    }
    if (estimatedSeconds < 0) {
      estimatedSeconds = Math.max(0.1, estimatedRows / 1_000_000);
    }

    const estimatedBytes = estimatedRows * 200;
    const estimatedCredits = Math.ceil(estimatedRows / 1000);

    return { estimatedRows, estimatedBytes, estimatedSeconds, estimatedCredits, warnings };
  }

  async query(
    sql: string,
    maxRows = this.opts.defaultRowLimit,
    _timeoutSeconds = this.opts.defaultTimeoutSeconds,
  ): Promise<QueryResult> {
    const conn = this.requireConn();
    const started = Date.now();
    const reader = await conn.runAndReadAll(`${sql}\nLIMIT ${maxRows + 1}`);
    const rows = reader.getRowObjects().map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = typeof v === "bigint" ? v.toString() : v;
      }
      return out;
    });
    const truncated = rows.length > maxRows;
    if (truncated) rows.length = maxRows;
    const elapsed = (Date.now() - started) / 1000;
    const columnTypes: Record<string, string> = {};
    for (const name of reader.columnNames()) columnTypes[name] = "?";

    return {
      rows,
      columnTypes,
      actualRows: rows.length,
      actualBytes: JSON.stringify(rows).length,
      actualSeconds: elapsed,
      truncated,
    };
  }
}
