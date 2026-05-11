# chainq spellbook

A dbt-duckdb project that turns raw chain Parquet into curated, queryable views.

This is a chainq-flavored fork conceptually rooted in the
[Dune Spellbook](https://github.com/duneanalytics/spellbook) (MIT). v0.0.x
only ships a few starter models so the end-to-end pipeline can be tested.
v0.1+ will port the upstream `dex/`, `tokens/`, and `nft/` subprojects.

## Quickstart

```bash
# Prereqs: Python ≥ 3.11
pip install dbt-duckdb

cd spellbook
DBT_PROFILES_DIR=. dbt deps
DBT_PROFILES_DIR=. dbt run --target dev
DBT_PROFILES_DIR=. dbt test
```

Env vars:

- `CHAINQ_DATA_DIR` — directory holding the raw `.parquet` files (default `../data`).
- `CHAINQ_CACHE_DB` — DuckDB file used as the dbt warehouse (default `../data/chainq-dbt.duckdb`).

## Models so far

| Subproject | Model | Notes |
|---|---|---|
| dex | `dex_trades` | Pass-through view over `dex.trades.parquet`. |
| erc20 | `erc20_transfers` | Adds `value_raw` cast to HUGEINT. |
| erc20 | `erc20_transfer_daily` | Daily rollup (chain, day). |
| filecoin | `filecoin_deals` | Converts epoch → UTC timestamp. |

## Adding a model

```bash
cp spellbook/models/erc20/erc20_transfers.sql spellbook/models/<subproject>/<name>.sql
# edit, then:
dbt run --select <name>
```

Macros live in `macros/`. The `parquet_source(name)` macro generates a
`read_parquet(...)` call for raw inputs so models stay engine-agnostic.
