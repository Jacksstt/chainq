/**
 * MCP server: tools that AI agents call.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { resolve, join } from "node:path";

import type { ChainqErrorCode, ChainqErrorShape } from "@chainq/core";
import { CATALOG, findTable, searchTables } from "./catalog.js";
import { Engine } from "./engine.js";
import { MetricRegistry } from "./metrics.js";
import {
  saveChart,
  inferFormatFromExt,
  type ChartType,
  type ChartFormat,
} from "./charts.js";
import { writeReport } from "./report.js";
import { BudgetTracker } from "./budget.js";

export interface ServerOptions {
  dataDir: string;
  metricsDir?: string;
  outDir?: string;
  name?: string;
  version?: string;
}

export async function startServer(transport: Transport, opts: ServerOptions): Promise<void> {
  const dataDir = resolve(opts.dataDir);
  const metricsDir = resolve(opts.metricsDir ?? "packages/semantic/metrics");
  const outDir = resolve(opts.outDir ?? join(dataDir, "out"));

  const engine = new Engine({ dataDir });
  await engine.start();

  const registry = new MetricRegistry(metricsDir);
  registry.load();

  const budget = new BudgetTracker();

  const server = new McpServer({
    name: opts.name ?? "chainq",
    version: opts.version ?? "0.0.0",
  });

  // -------- discovery ----------------------------------------------------
  server.tool(
    "chainq_list_tables",
    "List every curated table with a one-line summary.",
    {},
    async () => json(CATALOG.map((t) => ({ name: t.name, chains: t.chains, description: t.description }))),
  );

  server.tool(
    "chainq_search_tables",
    "Search curated tables by name or description.",
    {
      query: z.string(),
      chain: z.string().optional(),
    },
    async ({ query, chain }) => json(searchTables(query, chain)),
  );

  server.tool(
    "chainq_describe",
    "Return full schema, sample rows, and gotchas for one table.",
    { table: z.string() },
    async ({ table }) => {
      const t = findTable(table);
      return t ? json(t) : error(`Unknown table: ${table}`, "UNKNOWN_TABLE", { table });
    },
  );

  // -------- execution ----------------------------------------------------
  server.tool(
    "chainq_estimate_cost",
    "Estimate rows, bytes, seconds, and credits a SQL query would consume before running it. Also returns the current budget status and an advisory decision (whether running this query now would breach a cap).",
    { sql: z.string() },
    async ({ sql }) => {
      try {
        const estimate = await engine.estimate(sql);
        return json({
          ...estimate,
          budget: budget.status(),
          decision: budget.checkEstimate(estimate),
        });
      } catch (err) {
        return error(`estimate failed: ${(err as Error).message}`, "ESTIMATE_FAILED");
      }
    },
  );

  server.tool(
    "chainq_query",
    "Execute a SQL query with row and timeout caps. Result is cached for `chainq_recall`.",
    {
      sql: z.string(),
      max_rows: z.number().int().positive().optional(),
      timeout_seconds: z.number().int().positive().optional(),
      label: z.string().optional().describe("Human label stored with the cache entry."),
    },
    async ({ sql, max_rows, timeout_seconds, label }) => {
      try {
        const estimate = await engine.estimate(sql);
        const decision = budget.checkEstimate(estimate);
        if (!decision.allowed) {
          return error(
            `budget exceeded: ${decision.reason ?? "cap would be breached"} ${JSON.stringify(decision.wouldExceed ?? {})}`,
            "BUDGET_EXCEEDED",
            decision.wouldExceed,
          );
        }
        const result = await engine.query(sql, {
          maxRows: max_rows,
          timeoutSeconds: timeout_seconds,
          cacheLabel: label ?? null,
        });
        budget.record({
          rows: result.actualRows,
          bytes: result.actualBytes,
          seconds: result.actualSeconds,
        });
        return json({ ...result, budget: budget.status() });
      } catch (err) {
        const msg = (err as Error).message;
        const code: ChainqErrorCode = /timeout/i.test(msg) ? "QUERY_TIMEOUT" : "QUERY_FAILED";
        return error(`query failed: ${msg}`, code);
      }
    },
  );

  // -------- semantic layer -----------------------------------------------
  server.tool(
    "chainq_list_metrics",
    "Enumerate all semantic-layer metrics defined in YAML.",
    {},
    async () =>
      json(
        registry.list().map((m) => ({
          metric: m.metric,
          description: m.description,
          dimensions: m.dimensions,
          filters: m.filters,
          guardrails: m.guardrails,
        })),
      ),
  );

  server.tool(
    "chainq_metric",
    "Execute a named metric from the semantic layer.",
    {
      metric: z.string(),
      dimensions: z.array(z.string()).optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
      start: z.string().optional().describe("ISO timestamp (used by time-based metrics)."),
      end: z.string().optional(),
      start_epoch: z.number().optional().describe("Filecoin epoch (used by Filecoin metrics)."),
      end_epoch: z.number().optional(),
      max_rows: z.number().int().positive().optional(),
    },
    async ({ metric, dimensions, filters, start, end, start_epoch, end_epoch, max_rows }) => {
      const spec = registry.get(metric);
      if (!spec) return error(`unknown metric: ${metric}`, "UNKNOWN_METRIC", { metric });
      let sql: string;
      try {
        sql = registry.render(metric, {
          dimensions,
          filters: (filters ?? {}) as Record<string, string | number | boolean | string[]>,
          start,
          end,
          start_epoch,
          end_epoch,
        });
      } catch (err) {
        return error(`render failed: ${(err as Error).message}`, "INVALID_INPUT");
      }
      try {
        const estimate = await engine.estimate(sql);
        const decision = budget.checkEstimate(estimate);
        if (!decision.allowed) {
          return error(
            `budget exceeded: ${decision.reason ?? "cap would be breached"} ${JSON.stringify(decision.wouldExceed ?? {})}`,
            "BUDGET_EXCEEDED",
            decision.wouldExceed,
          );
        }
        const result = await engine.query(sql, {
          maxRows: max_rows ?? spec.guardrails.maxRows,
          timeoutSeconds: spec.guardrails.timeoutSeconds,
          cacheLabel: `metric:${metric}`,
        });
        budget.record({
          rows: result.actualRows,
          bytes: result.actualBytes,
          seconds: result.actualSeconds,
        });
        return json({ metric, sql, result, budget: budget.status() });
      } catch (err) {
        return error(`metric ${metric} failed: ${(err as Error).message}`, "QUERY_FAILED");
      }
    },
  );

  // -------- recall -------------------------------------------------------
  server.tool(
    "chainq_recall",
    "Search past query / metric runs cached by this engine.",
    {
      query: z.string().describe("Free text — matched against SQL and label."),
      limit: z.number().int().positive().optional(),
    },
    async ({ query, limit }) => {
      try {
        return json(await engine.recall(query, limit));
      } catch (err) {
        return error(`recall failed: ${(err as Error).message}`, "RECALL_FAILED");
      }
    },
  );

  server.tool(
    "chainq_recall_by_id",
    "Return the full cache entry including a sample of the saved result rows.",
    { id: z.string() },
    async ({ id }) => {
      try {
        const entry = await engine.recallById(id);
        return entry ? json(entry) : error(`no cache entry: ${id}`, "RECALL_FAILED", { id });
      } catch (err) {
        return error(`recall_by_id failed: ${(err as Error).message}`, "RECALL_FAILED");
      }
    },
  );

  // -------- chart_render -------------------------------------------------
  server.tool(
    "chainq_chart_render",
    "Render a vega-lite chart from a result-set and save it. Supports three output formats: 'svg' (static, server-rendered), 'html' (single-file interactive page loading vega via CDN), and 'vegalite-json' (raw vega-lite TopLevelSpec for downstream tooling). If `format` is omitted, it is inferred from the filename extension (.svg / .html / .json) and falls back to 'svg'.",
    {
      type: z.enum(["line", "bar", "area", "point"]),
      data: z.array(z.record(z.string(), z.unknown())),
      x: z.string(),
      y: z.string(),
      color: z.string().optional(),
      title: z.string().optional(),
      filename: z.string().describe("Filename (relative to the configured outDir)."),
      format: z
        .enum(["svg", "html", "vegalite-json"])
        .optional()
        .describe("Output format. Inferred from filename extension if omitted."),
    },
    async ({ type, data, x, y, color, title, filename, format }) => {
      try {
        const outPath = join(outDir, "charts", filename);
        const chosen: ChartFormat = format ?? inferFormatFromExt(outPath) ?? "svg";
        const path = await saveChart(
          { type: type as ChartType, data, x, y, color, title },
          outPath,
          chosen,
        );
        return json({ path, format: chosen, rows: data.length });
      } catch (err) {
        return error(`chart_render failed: ${(err as Error).message}`, "CHART_FAILED");
      }
    },
  );

  // -------- report -------------------------------------------------------
  server.tool(
    "chainq_report",
    "Write a Markdown report file. Supports frontmatter, tables, and chart embeds.",
    {
      title: z.string(),
      filename: z.string().describe("Markdown filename relative to outDir."),
      summary: z.string().optional(),
      frontmatter: z.record(z.string(), z.unknown()).optional(),
      sections: z.array(
        z.object({
          heading: z.string(),
          body: z.string().optional(),
          table: z.array(z.record(z.string(), z.unknown())).optional(),
          chartPath: z.string().optional(),
          caption: z.string().optional(),
        }),
      ),
    },
    async ({ title, filename, summary, frontmatter, sections }) => {
      try {
        const path = writeReport({
          title,
          outPath: join(outDir, "reports", filename),
          summary,
          frontmatter,
          sections,
        });
        return json({ path });
      } catch (err) {
        return error(`report failed: ${(err as Error).message}`, "REPORT_FAILED");
      }
    },
  );

  // -------- budget -------------------------------------------------------
  server.tool(
    "chainq_budget_set",
    "Set per-session budget caps. Pass an empty object to clear all caps. Subsequent chainq_query / chainq_metric calls pre-check against these caps.",
    {
      credits: z.number().int().nonnegative().optional(),
      rows: z.number().int().nonnegative().optional(),
      bytes: z.number().int().nonnegative().optional(),
      seconds: z.number().nonnegative().optional(),
    },
    async ({ credits, rows, bytes, seconds }) => {
      budget.setLimits({ credits, rows, bytes, seconds });
      return json(budget.status());
    },
  );

  server.tool(
    "chainq_budget_status",
    "Return active budget caps, running totals, and remaining headroom for this session.",
    {},
    async () => json(budget.status()),
  );

  server.tool(
    "chainq_budget_clear",
    "Clear all budget caps and reset consumption counters.",
    {},
    async () => {
      budget.setLimits({});
      budget.clearConsumption();
      return json(budget.status());
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

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function error(
  message: string,
  code: ChainqErrorCode = "UNKNOWN",
  details?: Record<string, unknown>,
) {
  const payload: ChainqErrorShape = {
    code,
    message,
    ...(details ? { details } : {}),
  };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}
