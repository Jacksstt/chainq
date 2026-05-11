# Development

## Prerequisites

- Node ≥ 20 (developed on 22 / 23)
- pnpm ≥ 9 (`npm i -g pnpm`)
- macOS or Linux (Windows untested)

## Install

```bash
pnpm install
```

## Test loop

```bash
pnpm typecheck        # type-check every package
pnpm seed             # write synthetic Parquet to ./data
pnpm test:smoke       # in-process Engine + catalog test
pnpm test:mcp         # end-to-end MCP over stdio
pnpm test             # all of the above, in order
```

`pnpm test` is what CI runs.

## Run the MCP server locally

```bash
pnpm mcp:serve
```

It speaks the MCP stdio protocol — connect any MCP client to its stdin/stdout.

## Wire to Claude Code

```bash
claude mcp add chainq -- pnpm --dir /absolute/path/to/chainq mcp:serve
```

Then in Claude Code, ask: _"Use chainq to describe `dex.trades` and query it."_

## Project layout

```
packages/
  core/              shared types
  mcp-server/        the MCP server (DuckDB engine + tool implementations)
  cli/               `chainq` CLI (spawns the MCP server in-process)
  ingest-evm/        cryo / Subsquid wrappers (stubs)
  ingest-filecoin/   Filfox / Glif / Spacescan wrappers (stubs)
  semantic/          YAML metric definitions
scripts/
  seed-sample-data.ts    synth-generate Parquet
  smoke-test.ts          in-process tests
  mcp-smoke-test.ts      end-to-end MCP test
docs/
  ARCHITECTURE.md
  COMPARISON.md      Dune Free / Analyst vs chainq
  ROADMAP.md
  adr/               architectural decision records
data/                gitignored, Parquet lives here
```

## Adding a new MCP tool

1. Implement it in `packages/mcp-server/src/server.ts` (or a new file under that package).
2. Register it via `server.tool(name, description, zodSchema, handler)`.
3. Add it to the catalog of expected tools in `scripts/mcp-smoke-test.ts`.
4. Document it in `packages/mcp-server/README.md`.

## Adding a new curated table

For v0.0.x: edit `packages/mcp-server/src/catalog.ts` and add a sample Parquet
generator to `scripts/seed-sample-data.ts`.

For v0.1+: tables will come from the dbt manifest in `spellbook/`. The catalog
will be auto-generated then.

## Style

- TypeScript strict, `verbatimModuleSyntax`. Imports use the `.js` suffix
  even for `.ts` source files (because of ESM resolution).
- No singletons. Pass dependencies as constructor args.
- Async / await everywhere; no callback APIs in our own code.
- Errors thrown from a tool become an `isError: true` MCP response — never
  let an exception escape the tool boundary.
