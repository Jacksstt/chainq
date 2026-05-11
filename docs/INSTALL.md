# Installing chainq

Pick whichever fits how you work. **None of these require Mac mini or a server you own.**

## 0. No install — browser playground

The fastest way to try chainq: **don't install anything**.

→ https://jacksstt.github.io/chainq (auto-deployed from `packages/playground`)

DuckDB-WASM runs in your browser. Paste a Parquet URL, write SQL. Same SQL
surface as the desktop chainq, no backend.

## 1. GitHub Codespaces (one click)

[![Open in Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Jacksstt/chainq)

Boots a fully-configured VS Code in the browser with chainq installed,
sample data seeded, and Claude Code wired up. Free for 60 hours/month on
the GitHub free plan.

## 2. One-click cloud deploy

| Provider | Free tier | Action |
|---|---|---|
| **Render** | 750h/month, 1 GB disk | [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Jacksstt/chainq) |
| **Fly.io** | hobby plan (3 small VMs) | `flyctl launch --copy-config` |
| **Railway** | $5 credit/month | Use `Dockerfile.chainq` |

After deploy, point Claude Code at the public URL:

```bash
claude mcp add chainq --url https://YOUR-DEPLOY.example.com
```

## 3. Local install (one-liner)

```bash
curl -fsSL https://raw.githubusercontent.com/Jacksstt/chainq/main/scripts/install.sh | sh
```

Installs into `~/.chainq`, drops a `chainq` shim into `~/.local/bin`. Needs
Node >= 20 already installed.

## 4. Docker

```bash
git clone https://github.com/Jacksstt/chainq.git
cd chainq
docker compose -f docker/docker-compose.yml up
```

Optional Metabase UI:

```bash
docker compose -f docker/docker-compose.yml --profile ui up
```

## 5. From source (developer mode)

```bash
git clone https://github.com/Jacksstt/chainq.git
cd chainq
pnpm install
pnpm seed
pnpm test         # full sanity check
pnpm mcp:serve    # start the MCP server
```

## What you need for each path

| Path | Hardware | Always-on? | RPC key? |
|---|---|---|---|
| 0. Playground | — | — | No |
| 1. Codespaces | — (GitHub VM) | While session active | No |
| 2. Render free | — (provider VM) | Yes | No |
| 3. Local install | Your laptop | When laptop is on | No (uses Subsquid) |
| 4. Docker on laptop | Your laptop | When laptop is on | No |
| 5. From source | Your laptop | When laptop is on | No |

→ **There is no "must have a Mac mini" path here.** Pick the easiest entry
for your situation.
