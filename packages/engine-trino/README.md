# @chainq/engine-trino

**Status: scaffold. Not implemented. Tracking issue: v0.5.0.**

## Purpose

Pluggable backend driver for **Trino / Starburst** — the engine Dune
Analytics uses for "DuneSQL." Pointing chainq at the same engine (over
your own Iceberg-on-S3 store) gives **maximum cross-portability of dbt
models** between chainq and Dune, plus distributed query throughput at
the petabyte tier where single-process DuckDB stops scaling.

## Why Trino

| | DuckDB (today) | Trino (v0.5.0 target) |
|---|---|---|
| Process model | Single-process, in-engine | Distributed coordinator + workers |
| Scale ceiling | ~1 TB on a single box | Petabyte-scale, horizontal |
| Latency profile | Sub-second on warm cache | Seconds, dominated by network + planning |
| Catalog | Direct Parquet read | Iceberg / Hive / Memory catalogs |
| Use case | Per-team, per-laptop | Per-org, hot metrics, dashboard tier |

Both run the same dbt models with `dbt-trino` / `dbt-duckdb` adapter
swap, ~95% dialect overlap.

## Roadmap entry

See `docs/ROADMAP.md` v0.5.0 section.

## How to contribute when work starts

1. Connect to a Trino coordinator via the HTTP `/v1/statement` POST API.
2. Stream pages via the `nextUri` field until the server emits no more.
3. Parse `EXPLAIN (TYPE IO)` output for the `estimate()` method — the
   IO plan exposes input-row estimates per table.
4. Honor the `maxRows` / `timeoutSeconds` caps via Trino session
   properties (`query_max_execution_time`, `query_max_run_time`).
5. Translate Trino errors to `ChainqError` with the right code
   (`QUERY_TIMEOUT`, `QUERY_FAILED`, etc.).

## Implementation notes

- The `EngineDriver` interface deliberately omits `recall` / `recallById`
  — those are session-cache concerns owned by the MCP server, not the
  backend driver. The DuckDB engine in `packages/mcp-server/src/engine.ts`
  also doesn't expose them at the driver level.
- The skeleton mirrors `@chainq/engine-clickhouse` exactly, so once
  either driver is finished the chainq MCP server can switch backends
  via a single import.
