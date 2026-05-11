#!/usr/bin/env node
/**
 * `chainq` CLI entry point.
 *
 * Subcommands (target):
 *   init       — initialize a workspace
 *   ingest     — backfill / realtime ingest
 *   transform  — run dbt
 *   mcp serve  — start the MCP server (stdio or http)
 *   query      — run a one-off SQL or named metric
 */

const args = process.argv.slice(2);
const [cmd] = args;

switch (cmd) {
  case "help":
  case "--help":
  case undefined:
    console.log(
      [
        "chainq — pre-alpha",
        "",
        "Usage:",
        "  chainq init",
        "  chainq ingest backfill --chain <id> --blocks <n>",
        "  chainq transform run",
        "  chainq mcp serve [--stdio|--http]",
        "  chainq query --metric <name> [--last 7d]",
        "",
        "Run `chainq help <command>` for details.",
      ].join("\n"),
    );
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error(`Try \`chainq help\`.`);
    process.exit(1);
}
