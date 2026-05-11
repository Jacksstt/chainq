# @chainq/engine-clickhouse

**Status:** Scaffold. Not implemented. Tracking issue: v0.5.0.

## Purpose

Pluggable backend driver for ClickHouse. Implements the same `EngineDriver`
contract that the existing DuckDB engine (in
`packages/mcp-server/src/engine.ts`) will eventually satisfy, alongside a
future Trino driver. The goal is one interface, multiple engines — the MCP
server picks whichever is appropriate for the deployment.

## Why ClickHouse

DuckDB is great for ad-hoc and Parquet-on-disk workloads: single-binary, zero
ops, embarrassingly good for analytical scans over local files. It is the
right default for chainq today.

ClickHouse is the right tool when you have continuous ingest plus
low-latency dashboard queries — the hot path for metrics. Columnar storage,
distributed execution, and seconds-to-sub-second responses on tables that
DuckDB cannot keep resident. v0.5.0 of chainq adds it as an opt-in backend.

## Roadmap

See `docs/ROADMAP.md`, v0.5.0 section, for the milestone definition and
acceptance criteria.

## Contributing (when work starts)

When v0.5.0 work opens, the implementation should:

1. Connect to the ClickHouse HTTP interface (`/`, `/ping`, `/?query=...`).
2. Implement `estimate()` by parsing `EXPLAIN ESTIMATE` output. Map row /
   byte / part counts onto the `QueryEstimate` shape from `@chainq/core`.
3. Implement `query()` with paginated `SELECT ... FORMAT JSON` and apply the
   `maxRows` and `timeoutSeconds` budget. Honour `max_execution_time` and
   `max_result_rows` server-side as defence in depth.
4. Surface structured errors for budget / timeout cases so callers can
   distinguish "query was killed" from "query crashed".
5. Note: the `EngineDriver` interface deliberately omits `recall` /
   `recallById`. Those are session-cache concerns owned by the MCP server,
   not the backend driver. Do not add them here.
