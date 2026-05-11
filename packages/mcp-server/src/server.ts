/**
 * MCP server: tools that AI agents call.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

import { CATALOG, findTable, searchTables } from "./catalog.js";
import { Engine } from "./engine.js";

export interface ServerOptions {
  dataDir: string;
  name?: string;
  version?: string;
}

export async function startServer(transport: Transport, opts: ServerOptions): Promise<void> {
  const engine = new Engine({ dataDir: opts.dataDir });
  await engine.start();

  const server = new McpServer({
    name: opts.name ?? "chainq",
    version: opts.version ?? "0.0.0",
  });

  // chainq.list_tables -----------------------------------------------------
  server.tool(
    "chainq_list_tables",
    "List every curated table with a one-line summary.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            CATALOG.map((t) => ({ name: t.name, chains: t.chains, description: t.description })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  // chainq.search_tables ---------------------------------------------------
  server.tool(
    "chainq_search_tables",
    "Search curated tables by name or description.",
    {
      query: z.string().describe("Free-text query, e.g. 'dex swaps' or 'erc20'."),
      chain: z.string().optional().describe("Optional chain filter (ethereum, base, filecoin, ...)."),
    },
    async ({ query, chain }) => ({
      content: [{ type: "text", text: JSON.stringify(searchTables(query, chain), null, 2) }],
    }),
  );

  // chainq.describe --------------------------------------------------------
  server.tool(
    "chainq_describe",
    "Return full schema, sample rows, and gotchas for one table.",
    {
      table: z.string().describe("Fully qualified table name, e.g. 'dex.trades'."),
    },
    async ({ table }) => {
      const descriptor = findTable(table);
      if (!descriptor) {
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown table: ${table}` }],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(descriptor, null, 2) }] };
    },
  );

  // chainq.estimate_cost ---------------------------------------------------
  server.tool(
    "chainq_estimate_cost",
    "Estimate rows, bytes, seconds, and credits a SQL query would consume before running it.",
    {
      sql: z.string().describe("DuckDB SQL. Do not include trailing semicolons."),
    },
    async ({ sql }) => {
      try {
        const est = await engine.estimate(sql);
        return { content: [{ type: "text", text: JSON.stringify(est, null, 2) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `estimate failed: ${(err as Error).message}` }],
        };
      }
    },
  );

  // chainq.query -----------------------------------------------------------
  server.tool(
    "chainq_query",
    "Execute a SQL query with row and timeout caps.",
    {
      sql: z.string().describe("DuckDB SQL."),
      max_rows: z.number().int().positive().optional().describe("Hard cap on rows returned."),
      timeout_seconds: z.number().int().positive().optional(),
    },
    async ({ sql, max_rows, timeout_seconds }) => {
      try {
        const result = await engine.query(sql, max_rows, timeout_seconds);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `query failed: ${(err as Error).message}` }],
        };
      }
    },
  );

  await server.connect(transport);

  const shutdown = async () => {
    await engine.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
