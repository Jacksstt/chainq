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
import { writeReport, type ReportFormat } from "./report.js";
import {
  concentrationSuite,
  distributionSummary,
  histogram,
  type BucketSpec,
  bucketize,
} from "./analytics.js";
import { findZScoreAnomalies, findIqrAnomalies, describeDistribution } from "./anomaly.js";
import { scoreReport } from "./report-rubric.js";
import { BudgetTracker } from "./budget.js";
import { describe as toolDesc } from "./tool-catalog.js";

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
    toolDesc("chainq_list_tables"),
    {},
    async () => json(CATALOG.map((t) => ({ name: t.name, chains: t.chains, description: t.description }))),
  );

  server.tool(
    "chainq_search_tables",
    toolDesc("chainq_search_tables"),
    {
      query: z.string(),
      chain: z.string().optional(),
    },
    async ({ query, chain }) => json(searchTables(query, chain)),
  );

  server.tool(
    "chainq_describe",
    toolDesc("chainq_describe"),
    { table: z.string() },
    async ({ table }) => {
      const t = findTable(table);
      return t ? json(t) : error(`Unknown table: ${table}`, "UNKNOWN_TABLE", { table });
    },
  );

  // -------- execution ----------------------------------------------------
  server.tool(
    "chainq_estimate_cost",
    toolDesc("chainq_estimate_cost"),
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
    toolDesc("chainq_query"),
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
    toolDesc("chainq_list_metrics"),
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
    toolDesc("chainq_metric"),
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

  // -------- analytics ----------------------------------------------------
  server.tool(
    "chainq_concentration",
    toolDesc("chainq_concentration"),
    {
      sql: z.string().describe("SELECT that produces (group_key, value) pairs. Either column order works; the `value_field` arg picks the numeric column."),
      value_field: z.string().describe("Name of the numeric column to weight on (e.g. `bytes_stored`)."),
      top_n: z.array(z.number().int().positive()).optional().describe("List of top-N cutoffs to compute. Default: [1, 5, 10, 25, 50, 100]."),
      max_lorenz_points: z.number().int().positive().optional(),
    },
    async ({ sql, value_field, top_n, max_lorenz_points }) => {
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
        const result = await engine.query(sql, { cacheLabel: `analytics:concentration:${value_field}` });
        budget.record({ rows: result.actualRows, bytes: result.actualBytes, seconds: result.actualSeconds });
        const inputRows = result.rows.map((r) => ({ value: Number((r as Record<string, unknown>)[value_field] ?? 0) }));
        const suite = concentrationSuite(inputRows, { topN: top_n, maxLorenzPoints: max_lorenz_points });
        return json({ ...suite, sql, sourceRows: result.actualRows, budget: budget.status() });
      } catch (err) {
        return error(`concentration failed: ${(err as Error).message}`, "QUERY_FAILED");
      }
    },
  );

  server.tool(
    "chainq_distribution",
    toolDesc("chainq_distribution"),
    {
      sql: z.string().describe("SELECT that produces a single numeric column (per row). Other columns are ignored."),
      value_field: z.string().describe("Name of the numeric column to summarise."),
    },
    async ({ sql, value_field }) => {
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
        const result = await engine.query(sql, { cacheLabel: `analytics:distribution:${value_field}` });
        budget.record({ rows: result.actualRows, bytes: result.actualBytes, seconds: result.actualSeconds });
        const values = result.rows.map((r) => Number((r as Record<string, unknown>)[value_field] ?? 0));
        return json({ ...distributionSummary(values), sql, budget: budget.status() });
      } catch (err) {
        return error(`distribution failed: ${(err as Error).message}`, "QUERY_FAILED");
      }
    },
  );

  server.tool(
    "chainq_histogram",
    toolDesc("chainq_histogram"),
    {
      sql: z.string(),
      value_field: z.string(),
      bucket_size: z.number().positive().describe("Histogram bucket width in the value column's units."),
    },
    async ({ sql, value_field, bucket_size }) => {
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
        const result = await engine.query(sql, { cacheLabel: `analytics:histogram:${value_field}:${bucket_size}` });
        budget.record({ rows: result.actualRows, bytes: result.actualBytes, seconds: result.actualSeconds });
        const values = result.rows.map((r) => Number((r as Record<string, unknown>)[value_field] ?? 0));
        return json({ ...histogram(values, bucket_size), sql, budget: budget.status() });
      } catch (err) {
        return error(`histogram failed: ${(err as Error).message}`, "QUERY_FAILED");
      }
    },
  );

  server.tool(
    "chainq_bucketize",
    toolDesc("chainq_bucketize"),
    {
      sql: z.string(),
      value_field: z.string(),
      buckets: z.array(z.object({
        min: z.number(),
        max: z.number(),
        label: z.string(),
      })).describe("Tier definitions. `min` is inclusive, `max` is exclusive (Infinity → use a huge sentinel like 1e308)."),
    },
    async ({ sql, value_field, buckets }) => {
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
        const result = await engine.query(sql, { cacheLabel: `analytics:bucketize:${value_field}` });
        budget.record({ rows: result.actualRows, bytes: result.actualBytes, seconds: result.actualSeconds });
        const rows = result.rows as Array<Record<string, unknown>>;
        const tiers: BucketSpec[] = buckets;
        const out = bucketize(rows, (r) => Number(r[value_field] ?? 0), tiers);
        // Strip the per-item arrays from the response — they can be large.
        return json({
          tiers: out.map((t) => ({ label: t.label, count: t.count, total: t.total, share: t.share })),
          sql,
          budget: budget.status(),
        });
      } catch (err) {
        return error(`bucketize failed: ${(err as Error).message}`, "QUERY_FAILED");
      }
    },
  );

  // -------- writing-quality / anomaly ------------------------------------
  server.tool(
    "chainq_anomalies",
    toolDesc("chainq_anomalies"),
    {
      sql: z.string().describe("SELECT that produces (group_key, value) pairs. The value column is fed into the detector."),
      value_field: z.string().describe("Name of the numeric column to scan for outliers."),
      method: z.enum(["zscore", "iqr"]).optional().describe("Detector: zscore (default) or iqr."),
      z_threshold: z.number().positive().optional().describe("Z-score threshold (default 2.0). Used only for method=zscore."),
      iqr_multiplier: z.number().positive().optional().describe("IQR multiplier (default 1.5, Tukey's fence). Used only for method=iqr."),
      limit: z.number().int().positive().optional(),
    },
    async ({ sql, value_field, method, z_threshold, iqr_multiplier, limit }) => {
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
        const result = await engine.query(sql, { cacheLabel: `analytics:anomalies:${value_field}` });
        budget.record({ rows: result.actualRows, bytes: result.actualBytes, seconds: result.actualSeconds });
        const rows = result.rows as Array<Record<string, unknown>>;
        const accessor = (r: Record<string, unknown>) => Number(r[value_field] ?? 0);
        const dist = describeDistribution(rows, accessor);
        const hits = method === "iqr"
          ? findIqrAnomalies(rows, accessor, { ...(iqr_multiplier != null ? { multiplier: iqr_multiplier } : {}), ...(limit != null ? { limit } : {}) })
          : findZScoreAnomalies(rows, accessor, { ...(z_threshold != null ? { zThreshold: z_threshold } : {}), ...(limit != null ? { limit } : {}) });
        return json({
          distribution: dist,
          anomalies: hits.map((h) => ({ row: h.row, value: h.value, z: +h.z.toFixed(3), direction: h.direction, baseline: h.baseline, stdev: h.stdev })),
          method: method ?? "zscore",
          sql,
          budget: budget.status(),
        });
      } catch (err) {
        return error(`anomalies failed: ${(err as Error).message}`, "QUERY_FAILED");
      }
    },
  );

  server.tool(
    "chainq_score_report",
    toolDesc("chainq_score_report"),
    {
      title: z.union([z.string(), z.object({ en: z.string().optional(), ja: z.string().optional() })]),
      summary: z.union([z.string(), z.object({ en: z.string().optional(), ja: z.string().optional() })]).optional(),
      sections: z.array(z.object({
        heading: z.union([z.string(), z.object({ en: z.string().optional(), ja: z.string().optional() })]),
        body: z.union([z.string(), z.object({ en: z.string().optional(), ja: z.string().optional() })]).optional(),
        table: z.array(z.record(z.string(), z.unknown())).optional(),
        chartPath: z.string().optional(),
        caption: z.union([z.string(), z.object({ en: z.string().optional(), ja: z.string().optional() })]).optional(),
        downloads: z.array(z.object({
          path: z.string(),
          label: z.union([z.string(), z.object({ en: z.string().optional(), ja: z.string().optional() })]).optional(),
          format: z.enum(["csv","json","parquet","html","svg","png","other"]).optional(),
        })).optional(),
      })),
      locale: z.enum(["en","ja","both"]).optional(),
    },
    async (args) => {
      try {
        const score = scoreReport({
          title: args.title,
          outPath: "(unused)",
          ...(args.summary ? { summary: args.summary } : {}),
          sections: args.sections,
          ...(args.locale ? { locale: args.locale } : {}),
        });
        return json(score);
      } catch (err) {
        return error(`score_report failed: ${(err as Error).message}`, "INVALID_INPUT");
      }
    },
  );

  // -------- recall -------------------------------------------------------
  server.tool(
    "chainq_recall",
    toolDesc("chainq_recall"),
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
    toolDesc("chainq_recall_by_id"),
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
    toolDesc("chainq_chart_render"),
    {
      type: z.enum(["line", "bar", "area", "point", "stacked-bar", "donut"]).describe(
        "Chart mark. `stacked-bar` requires a `color` field that names the stack dimension. " +
        "`donut` uses `y` for the angle (quantity) and `x` (or `color`) as the slice label.",
      ),
      data: z.array(z.record(z.string(), z.unknown())),
      x: z.string(),
      y: z.string(),
      color: z.string().optional(),
      title: z.string().optional(),
      subtitle: z.string().optional().describe("Smaller caption-style text under the title."),
      theme: z.enum(["light", "dark"]).optional().describe("Theme name. Default 'light'."),
      siFormat: z.boolean().optional().describe("Format numeric axes with SI prefixes (28.5k, 1.6M). Default true."),
      filename: z.string().describe("Filename (relative to the configured outDir)."),
      format: z
        .enum(["svg", "html", "vegalite-json", "png"])
        .optional()
        .describe("Output format. Inferred from filename extension if omitted."),
      pngWidth: z.number().int().positive().optional().describe("PNG output width in pixels. Only used when format=png. Default 600."),
      pngScale: z.number().positive().optional().describe("PNG pixel-density multiplier (2 = retina). Default 1."),
      pngBackground: z.string().optional().describe("CSS color for PNG background. Default `#ffffff`."),
    },
    async ({ type, data, x, y, color, title, subtitle, theme, siFormat, filename, format, pngWidth, pngScale, pngBackground }) => {
      try {
        const outPath = join(outDir, "charts", filename);
        const chosen: ChartFormat = format ?? inferFormatFromExt(outPath) ?? "svg";
        const path = await saveChart(
          { type: type as ChartType, data, x, y, color, title, subtitle, theme, siFormat },
          outPath,
          chosen,
          { pngWidth, pngScale, pngBackground },
        );
        return json({ path, format: chosen, rows: data.length });
      } catch (err) {
        return error(`chart_render failed: ${(err as Error).message}`, "CHART_FAILED");
      }
    },
  );

  // -------- report -------------------------------------------------------
  const localized = z.union([
    z.string(),
    z.object({ en: z.string().optional(), ja: z.string().optional() }),
  ]);
  server.tool(
    "chainq_report",
    toolDesc("chainq_report"),
    {
      title: localized,
      filename: z.string().describe("Report filename relative to outDir. Format is inferred from the extension: .html (default), .md / .markdown for Markdown."),
      summary: localized.optional(),
      frontmatter: z.record(z.string(), z.unknown()).optional(),
      sections: z.array(
        z.object({
          heading: localized,
          body: localized.optional(),
          table: z.array(z.record(z.string(), z.unknown())).optional(),
          chartPath: z.string().optional(),
          caption: localized.optional(),
          chartHeight: z.number().int().positive().optional().describe("Pixel height for interactive (.html) chart embeds. Default 360."),
          downloads: z.array(z.object({
            path: z.string(),
            label: localized.optional(),
            format: z.enum(["csv", "json", "parquet", "html", "svg", "png", "other"]).optional(),
          })).optional().describe("Download chips rendered under the section (CSV / JSON / Parquet …)."),
        }),
      ),
      format: z.enum(["html", "markdown"]).optional().describe("Output format. Defaults to HTML (or inferred from filename)."),
      locale: z.enum(["en", "ja", "both"]).optional().describe("Render locale: 'en' (default) / 'ja' / 'both' (CSS-only language toggle, no JS)."),
      brand: z.object({
        name: z.string().optional(),
        logoUrl: z.string().optional(),
        accentColor: z.string().optional(),
        footer: localized.optional(),
      }).optional().describe("Brand overrides: eyebrow `name`, header `logoUrl`, CSS `accentColor`, footer text."),
    },
    async ({ title, filename, summary, frontmatter, sections, format, locale, brand }) => {
      try {
        const path = writeReport(
          {
            title,
            outPath: join(outDir, "reports", filename),
            summary,
            frontmatter,
            sections,
            locale,
            brand,
          },
          format as ReportFormat | undefined,
        );
        return json({
          path,
          format: format ?? (filename.endsWith(".md") || filename.endsWith(".markdown") ? "markdown" : "html"),
          locale: locale ?? "en",
        });
      } catch (err) {
        return error(`report failed: ${(err as Error).message}`, "REPORT_FAILED");
      }
    },
  );

  // -------- budget -------------------------------------------------------
  server.tool(
    "chainq_budget_set",
    toolDesc("chainq_budget_set"),
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
    toolDesc("chainq_budget_status"),
    {},
    async () => json(budget.status()),
  );

  server.tool(
    "chainq_budget_clear",
    toolDesc("chainq_budget_clear"),
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
