# chainq docker stack

A turn-key, RPC-free chainq stack. One `docker compose up` and you have:

- An MCP server reachable via `docker exec` or stdio.
- A cron container that periodically pulls Subsquid snapshots into a shared
  data volume.
- An optional Metabase profile if you want a familiar web UI.

## Quickstart

```bash
docker compose -f docker/docker-compose.yml up         # core stack
docker compose -f docker/docker-compose.yml --profile ui up   # + Metabase on http://localhost:3000
```

## Environment knobs

| Variable | Default | What it does |
|---|---|---|
| `CHAINQ_CHAINS` | `base` | Comma-separated chains to keep updated. |
| `CHAINQ_INTERVAL_SEC` | `3600` | Seconds between cron pulls. |
| `CHAINQ_BLOCKS_PER_RUN` | `2000` | Blocks to pull per cron iteration. |

## Storage

All Parquet artifacts and the DuckDB cache live in the named volume
`chainq_data`. Inspect with:

```bash
docker volume inspect chainq_chainq_data
```

To wire the chainq MCP container to Claude Code on the host:

```bash
claude mcp add chainq -- docker exec -i chainq pnpm mcp:serve
```

## Hardware

- 2 vCPU / 4 GB RAM is sufficient for hobby use.
- No host disk requirement other than the volume size (a few GB per chain
  per month at log-only granularity).

## Notes

- The cron loop is intentionally minimal. For production replace with a
  k8s CronJob, systemd timer, or any other scheduler.
- `reth` / `geth` are deliberately not included. The point of this stack is
  to demonstrate the *RPC-free* path — pulling from public archives instead
  of running a full node. If you want a node, see
  [`docs/RUNNING_A_NODE.md`](../docs/RUNNING_A_NODE.md).
