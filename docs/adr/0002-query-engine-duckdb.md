# ADR-0002: DuckDB as the default query engine

**Status:** Accepted (2026-05-11)

## Context

The query engine is the single most consequential architectural choice in `chainq`. It dictates operational complexity, cost, performance ceiling, and the talent we can reasonably attract. We must pick a default that lets a 1.5-engineer team operate the system, while leaving a credible upgrade path for teams with petabyte-scale needs.

We evaluated DuckDB, ClickHouse, Trino, Apache DataFusion, Snowflake, and BigQuery.

## Decision

**Default engine: DuckDB.** Optional secondary: ClickHouse for hot pre-aggregated metrics. Trino support is deferred to Phase 2.

## Rationale

Scoring on five axes (1 = worst, 5 = best):

| Engine | Talent supply | Performance | Ops burden | Agent fit | Monthly cost |
|---|---|---|---|---|---|
| **DuckDB** | 4 | 4 (single-node) | 5 | 5 | $0–$50 |
| ClickHouse (self-hosted) | 3 | 5 (aggregations) | 4 | 4 | $50–$300 |
| Trino (self-hosted) | 2 | 5 | 1 | 3 | $500–$5,000 |
| DataFusion | 2 | 4 | 3 | 5 | $0–$100 |
| Snowflake | 4 | 5 | 5 | 3 | $1,000+ |
| BigQuery | 4 | 5 | 5 | 3 | $500+ |

DuckDB wins on three properties that matter for the agent-first design:

1. **One binary, embeddable.** An agent can spin up a fresh DuckDB process per task and discard it. Multi-tenancy concerns disappear.
2. **Reads Parquet (and Iceberg) natively.** Storage is independent of the engine.
3. **The talent supply is effectively "anyone who knows SQL + Postgres dialect"** — far broader than Trino's operational pool.

Performance is competitive with Trino up to roughly the 1-10 TB range on a modern workstation. Above that, DuckDB stops being the right tool.

## Alternatives considered

- **Trino** (Dune's choice). Genuinely the right answer at petabyte scale and multi-tenant SaaS. For us it is an operational anvil: coordinator, workers, Hive metastore, connector configs — none of which a 1.5-engineer team can babysit. Reconsider only after revenue ≥ ¥100M ARR or data ≥ 50 TB.
- **ClickHouse.** Excellent for fixed analytical schemas with high-throughput aggregations. Less ergonomic for ad-hoc joins across raw blockchain tables. We will use it for *materialised* metrics in Phase 2, not as the primary engine.
- **Apache DataFusion.** Technically beautiful (Rust, embeddable), but the ecosystem and Iceberg connector are too young for production. Phase 2 candidate for a Rust-native rewrite of the MCP server.
- **Managed warehouses (Snowflake, BigQuery).** Lock-in cost is unacceptable for an open-source project; also defeats the self-host requirement.

## Consequences

- We commit to single-node operation in v0.x. Distribution is a non-goal until v0.5.
- Bulk ingestion writes Parquet to disk or S3; the engine reads from there. The engine never owns the data.
- Engine-specific SQL is forbidden in the spellbook fork; queries must work on both DuckDB and (eventually) Trino.

## Revisit when

- A single chain's curated tables exceed 50 TB on disk, or
- Query latency on the p95 production workload exceeds 30 seconds, or
- A pilot customer requires multi-machine concurrency on the same dataset.

At any of those points, re-evaluate ClickHouse-as-primary or Trino.
