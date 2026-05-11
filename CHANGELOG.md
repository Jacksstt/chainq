# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Pre-`v0.1.0` is breaking by default; we only call out highlights.

## [Unreleased]

### Added (this push — zero-infrastructure entry points)

- **`.devcontainer/`** — Codespaces / VS Code Dev Containers config. One-click
  spin-up with seed data already loaded; Claude Code extension preinstalled.
- **`packages/playground/`** — DuckDB-WASM in the browser. Static site (Vite +
  TypeScript) lets anyone paste a Parquet URL and run SQL with zero install.
  Build is 195 KB JS (46 KB gzipped). Auto-deployed to GitHub Pages via
  `playground-deploy.yml`.
- **`fly.toml` + `render.yaml`** — one-click cloud deploy templates. Render
  free tier hosts a chainq instance with 1 GB persistent disk; Fly.io hobby
  plan also works.
- **`scripts/install.sh`** — `curl | sh` installer. Clones to `~/.chainq`,
  pnpm install, seeds data, drops a `chainq` shim onto `$HOME/.local/bin`.
- **`docs/INSTALL.md`** — five install paths in a single comparison table.
  Explicitly documents that **no path requires a Mac mini or an always-on
  server you own**.
- README updated with badge row for Codespaces / Render / Playground.

### Added (previous push — RPC-free / node-free stack)

- **`@chainq/snapshot`** — `pull()` streams from a public Subsquid archive
  into compressed Parquet. CLI: `chainq pull --chain <id> --from N --to N`.
  No RPC key required. `PUBLIC_ARCHIVES` covers Ethereum, Base, Polygon,
  Arbitrum, Optimism.
- **`@chainq/storage`** — Filecoin / IPFS pinning. `push()` to
  lighthouse.storage, `pull()` by CID. Community-shared snapshots become a
  first-class artifact.
- **`@chainq/light-client`** — trust-minimised verification skeleton.
  `verifyRows()` API + `RESEARCH.md` covering the Helios / Lodestar
  integration plan for v0.2.0.
- **`docker/`** — one-command self-hosted stack. `Dockerfile.chainq`,
  `Dockerfile.cron`, `docker-compose.yml`, optional `--profile ui` for
  Metabase. Pulls from public archives by default; no RPC needed.
- **`docs/RUNNING_A_NODE.md`** — optional path for users who really want
  to run reth / Lotus locally.
- README updated with the RPC-free path; new packages listed.

### Added (previous push)

- **`@chainq/whuffie`** — new package. Sybil-resistant reputation data product.
  TypeScript types, reference `compositeScore()` implementation, and
  `RESEARCH.md` mapping the formal model to the table schema. Spellbook
  models for `whuffie.attestations`, `whuffie.hostage_bonds`, `whuffie.proofs`,
  `whuffie.reputations` (placeholders until empirical phase).
- **`@chainq/ingest-solana`** — Helius RPC client. `signaturesFor`,
  `enrichedTransactions`, `fetchTokenTransfers`.
- **Subsquid realtime stream** in `@chainq/ingest-evm/src/realtime.ts` —
  `streamSubsquid()` async iterator and `collectStream()` helper.
- **dbt-duckdb actually runs** — `scripts/dbt-run.sh` and `pnpm dbt:run`.
  CI now builds all 8 spellbook models on Python 3.11.
- **Brand**: `assets/logo.svg`, `assets/social-card.svg`. README badges and
  logo embedded.
- **`docs/CLAUDE_CODE_INTEGRATION.md`** — three install paths, sanity prompts,
  and a real investigation prompt that touches every tool.
- **New semantic metric**: `whuffie_score`.

### Added

- MCP tool surface grew to **11 tools**: discovery (`list_tables`, `search_tables`,
  `describe`), execution (`estimate_cost`, `query`), semantic
  (`list_metrics`, `metric`), memory (`recall`, `recall_by_id`), output
  (`chart_render`, `report`).
- **Semantic layer**: YAML metric definitions under `packages/semantic/metrics/`
  with `dimension_expressions` (derived columns like
  `date_trunc('day', block_time)`) and `guardrails` (max_range_days, max_rows,
  timeout_seconds). Three starter metrics shipped.
- **Persistent query cache** (`data/.chainq-cache.duckdb`) backs the `recall`
  tools — every `query` and `metric` invocation is searchable later.
- **Chart rendering** via vega-lite → SVG, no node-canvas dependency.
- **Markdown report writer** with optional frontmatter, tables, and chart embeds.
- **Per-query timeout** via `Promise.race`. Note: DuckDB's native binding may
  block libuv, so the timeout reliably rejects the JS promise but cannot
  always kill the underlying SQL — see DEVELOPMENT.md.
- **`@chainq/ingest-evm`**: real `cryo` CLI wrapper with `assertCryoInstalled`
  and a `backfill(opts)` that streams Parquet to disk.
- **`@chainq/ingest-filecoin`**: Filfox REST + Spacescan REST clients for
  recent deals and miner snapshots.
- **`spellbook/`**: dbt-duckdb project skeleton with starter models for
  `dex.trades`, `erc20.transfers` (+ daily rollup), and `filecoin.deals` (with
  epoch → UTC conversion).
- Recursive bigint / Date normalization on query results so JSON serialization
  is safe regardless of DuckDB column types.

### Earlier (initial commit)

- `chainq_list_tables`, `chainq_search_tables`, `chainq_describe`,
  `chainq_estimate_cost`, `chainq_query`.
- DuckDB engine that reads Parquet files from `data/` as views.
- Hand-curated catalog of three tables.
- `chainq mcp serve` CLI subcommand.
- `pnpm seed` synthetic data generator.
- Smoke + MCP end-to-end tests in CI.
- `DEVELOPMENT.md`, `docs/COMPARISON.md`.

## [0.0.0] — 2026-05-11

### Added

- Initial monorepo skeleton (pnpm workspaces).
- Architecture docs, ROADMAP, 3 ADRs.
- README, CONTRIBUTING, LICENSE (MIT).
- Package stubs: `core`, `mcp-server`, `cli`, `ingest-evm`, `ingest-filecoin`, `semantic`.
- GitHub Actions CI skeleton.
