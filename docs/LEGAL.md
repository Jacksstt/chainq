# Legal / Licensing / Trademark Notice

> This document explains, in plain language, what chainq reuses, under
> what licenses, and how chainq relates to Dune Analytics, Inc. It is
> **not legal advice** — if you're shipping a derivative product, talk
> to your own counsel.

## TL;DR

- chainq's own source code is **MIT**.
- chainq is **not affiliated with Dune Analytics, Inc.**
- We do **not** reverse-engineer, decompile, or copy any proprietary
  Dune software, binaries, SaaS code, or trade secrets.
- What we share with Dune is (a) **publicly documented architectural
  ideas** (Parquet + dbt + SQL engine — none of which Dune owns or
  invented), and (b) the **MIT-licensed Spellbook repository** Dune
  themselves publish on GitHub.

## What chainq actually reuses from Dune

Exactly one thing: **the Spellbook dbt model repository** published at
[`duneanalytics/spellbook`](https://github.com/duneanalytics/spellbook),
which Dune Analytics releases under the **MIT License**. We adapt the
model SQL to compile on dbt-duckdb (the Spellbook upstream targets
dbt-trino). Where we adapt their files we preserve the original
copyright header and keep the upstream `LICENSE` alongside our
modifications.

We do **not** copy:

- any private Dune engine code
- any closed-source Dune ingestion pipeline
- any non-public Dune dashboards, query templates, or product UI
- any Dune SaaS infrastructure code

## Architecture similarity ≠ copying

The architectural pattern — *raw events as columnar files, dbt for
curation, a SQL engine on top, a UI layer for consumption* — is not
proprietary to Dune. It is a generic OLAP architecture used by
Snowflake, Databricks, MotherDuck, Tabular, Iceberg-based lakehouses,
and dozens of OSS projects. **Architectural patterns are not protected
by copyright or patent** (the "idea/expression dichotomy" under US
copyright law, and analogous rules in JP/EU jurisdictions).

What *can* be protected is the **specific implementation** (source
code, binaries) and the **brand/trademark** (the name "Dune", the logo,
trade dress). We touch neither.

## Reverse engineering?

No. Reverse engineering means analyzing a product (typically by
inspecting binaries, decompiling, or probing a black-box service) to
recover its internals. We do none of that:

- We read Dune's **public blog posts and engineering talks** to
  understand what they built (this is public information).
- We use Dune's **own published MIT code** (Spellbook).
- We use **independent, publicly-documented protocols** (Subsquid v2
  archives, Filfox REST, Helius RPC, EVM JSON-RPC) for data ingestion.

## Trademark policy

"Dune" and "Dune Analytics" are trademarks of Dune Analytics, Inc.
chainq's use of those names is limited to **nominative fair use** —
specifically, to truthfully describe (a) the architectural pattern
chainq implements, and (b) the upstream Spellbook repository. We:

- ✅ Say "chainq is the self-hosted analogue of Dune's architecture".
- ✅ Say "chainq Spellbook models compile from upstream Dune Spellbook".
- ❌ Do **not** put "Dune" in our product name, domain, or logo.
- ❌ Do **not** imply partnership, endorsement, or affiliation.
- ❌ Do **not** use Dune's logo, color scheme, or trade dress.

If Dune Analytics, Inc. requests changes to comparative language, we
will respond promptly. Contact: `legal@primebeat.jp`.

## Third-party licenses

| Dependency | License | Use |
|---|---|---|
| `duneanalytics/spellbook` | MIT (© Dune Analytics) | Curated dbt models (adapted) |
| `paradigmxyz/cryo` | MIT / Apache-2.0 | EVM extraction |
| `subsquid/squid-sdk` archives | Public HTTP archives (used as documented API) | EVM realtime ingestion |
| DuckDB | MIT | Query engine |
| `dbt-duckdb` | Apache-2.0 | Transformation |
| Vega-Lite | BSD-3-Clause | Chart rendering |
| `@resvg/resvg-js` | MPL-2.0 | SVG → PNG |
| `@modelcontextprotocol/sdk` | MIT (© Anthropic) | MCP server transport |
| Helius RPC | Documented public API | Solana ingestion |
| Filfox / Spacescan REST | Documented public APIs | Filecoin ingestion |

All package-level LICENSE files are preserved under
`node_modules/<pkg>/LICENSE` after install.

## Patents

We are not aware of any patents covering the techniques chainq uses. If
you become aware of one, please open an issue or contact
`legal@primebeat.jp`.

## Data licensing

chainq is a **framework**. It does not bundle blockchain data. When you
run chainq, you pull data from public RPC endpoints / archives that are
governed by their own terms of service (Subsquid public archives,
Helius free tier, etc.). You are responsible for complying with those
terms. chainq does not redistribute proprietary datasets.

## Contributions

By submitting a PR you agree to license your contribution under the
project's MIT License. See [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Contact

Questions about licensing, trademark, or affiliation: `legal@primebeat.jp`.
