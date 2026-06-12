#!/usr/bin/env bash
# Run the chainq spellbook against the local Parquet files in ./data.
#
# Prereqs (one-time):
#   curl -LsSf https://astral.sh/uv/install.sh | sh
#   cd spellbook && uv venv --python 3.11 && uv pip install dbt-core dbt-duckdb

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}/spellbook"

if [ ! -d ".venv" ]; then
  echo "spellbook/.venv missing — bootstrap with:"
  echo "  cd spellbook && uv venv --python 3.11 && uv pip install dbt-core dbt-duckdb"
  exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate

export DBT_PROFILES_DIR="."
export CHAINQ_DATA_DIR="${REPO_ROOT}/data"
export CHAINQ_CACHE_DB="${REPO_ROOT}/data/chainq-dbt.duckdb"

dbt deps  >/dev/null 2>&1 || true
dbt seed --quiet          # load the event_signatures decode registry
dbt run "$@"
