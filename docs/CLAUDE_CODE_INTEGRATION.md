# Using chainq from Claude Code

This guide gets a Claude Code session talking to a local `chainq` MCP server in
under five minutes.

## 1. One-time setup

```bash
git clone https://github.com/Jacksstt/chainq.git
cd chainq
pnpm install
pnpm seed        # writes ./data/*.parquet
```

## 2. Register the MCP server with Claude Code

There are three ways to expose chainq to Claude Code; pick whichever fits your
existing workflow.

### Option A — direct command (recommended for dev)

```bash
claude mcp add chainq -- pnpm --dir /absolute/path/to/chainq mcp:serve
```

Claude will spawn the server on demand. The repo's own `tsx` runs the server,
so you don't need to build anything.

### Option B — Node-resolvable bin

If you've globally linked the workspace (`pnpm --dir /path/to/chainq link --global`),
the binary `chainq` is on your PATH:

```bash
claude mcp add chainq -- chainq mcp serve
```

### Option C — settings.local.json

If you prefer to keep MCP servers in version control alongside other config,
add to your project's `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "chainq": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/chainq", "mcp:serve"],
      "env": {
        "CHAINQ_DATA_DIR": "/absolute/path/to/chainq/data"
      }
    }
  }
}
```

## 3. Sanity check

In a Claude Code session:

> Use chainq. List the tables you can see, then describe `dex.trades`.

You should see Claude call `chainq_list_tables` then `chainq_describe`, and
report the synthetic catalog (`dex.trades`, `erc20.transfers`, `filecoin.deals`,
and four `whuffie.*` placeholders if dbt has been run).

## 4. A realistic investigation prompt

> Use chainq. I want to understand DEX activity on Base over the last week of
> the seeded data. Run `chainq_metric dex_volume_usd` grouped by `dex_name`
> and `day`, save a bar chart to `volume.svg`, and write a Markdown report
> to `dex-base.md` with a one-paragraph summary, the table, and the chart.

Expected agent flow:

1. `chainq_list_metrics`
2. `chainq_describe(table="dex.trades")` (to confirm column semantics)
3. `chainq_estimate_cost(...)` for the planned SQL
4. `chainq_metric(metric="dex_volume_usd", dimensions=["dex_name","day"], …)`
5. `chainq_chart_render(...)`
6. `chainq_report(...)`

Output appears in `data/out/charts/` and `data/out/reports/`.

## 5. Adding chainq to an existing Claude Code project

`.claude/settings.local.json` extends — it does not replace — your global
config. Drop the `mcpServers` block above into a project-level settings file
and the server will only attach when you `cd` into that project.

For the Prime Beat vault we typically point `CHAINQ_DATA_DIR` to a shared
location so research artifacts (charts, reports) land directly in
`~/Documents/PrimeBeat-Vault/60-Research/`.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `tool list_tools returned ENOENT` | `pnpm install` and `pnpm seed` first |
| `Unknown table: ...` | `pnpm seed` to generate sample data, or point `CHAINQ_DATA_DIR` to a directory containing your own Parquet |
| dbt views unavailable | run `pnpm dbt:run` after seeding |
| Claude can't find the server | use an absolute path in `--dir` — relative paths confuse the MCP launcher |

## 7. Going beyond synthetic data

When you have real Parquet to query, drop it in `data/<schema>.<table>.parquet`
following the catalog naming scheme, restart the MCP server, and you can query
it immediately. The catalog can be extended in
`packages/mcp-server/src/catalog.ts` — that's how the agent knows what columns
and gotchas to expect.
