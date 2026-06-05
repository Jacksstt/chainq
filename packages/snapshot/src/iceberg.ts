/**
 * Apache Iceberg READ support, backed by DuckDB's `iceberg` extension.
 *
 * This is the read path only: it builds the `iceberg_scan(...)` SQL chainq's
 * query/snapshot layers run against an existing Iceberg table, and a tiny
 * helper to install + load the extension on a DuckDB connection. Writing or
 * maintaining Iceberg tables (snapshots, compaction, manifests) is out of
 * scope here.
 */

/**
 * Minimal shape of a DuckDB connection we depend on. Kept loose on purpose so
 * any object exposing an async `run(sql)` (e.g. `@duckdb/node-api`'s
 * `DuckDBConnection`) satisfies it without importing the concrete type.
 */
export interface IcebergDuckDBConnection {
  run(sql: string): Promise<unknown>;
}

/**
 * Build a `SELECT * FROM iceberg_scan('<path>')` statement for an Iceberg
 * table at `path` (a table directory, an S3 URI, or a metadata `.json`).
 *
 * Single quotes in `path` are escaped (doubled) so the emitted SQL is a valid
 * single-quoted literal even for awkward paths.
 */
export function icebergScanSql(path: string): string {
  const escaped = path.replace(/'/g, "''");
  return `SELECT * FROM iceberg_scan('${escaped}')`;
}

/**
 * Install and load the DuckDB `iceberg` extension on `conn`. The first
 * `INSTALL` fetches the extension over the network; once cached, `LOAD`
 * works offline. Run this once per connection before issuing
 * {@link icebergScanSql} queries.
 */
export async function loadIcebergExtension(conn: IcebergDuckDBConnection): Promise<void> {
  await conn.run("INSTALL iceberg;");
  await conn.run("LOAD iceberg;");
}
