/**
 * Semantic-layer metric loader.
 *
 * Reads YAML files from a `metrics/` directory and exposes them in a
 * shape MCP tools can introspect. A metric is just a parameterised SQL
 * template — no Cube.dev complexity.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

import type { MetricDescriptor, MetricGuardrails } from "@chainq/core";

export interface MetricSpec extends MetricDescriptor {
  sqlTemplate: string;
  guardrails: MetricGuardrails;
  /** Optional per-dimension SQL expression (e.g. `date_trunc('day', block_time)`). */
  dimensionExpressions?: Record<string, string>;
}

export class MetricRegistry {
  private metrics = new Map<string, MetricSpec>();

  constructor(private readonly metricsDir: string) {}

  load(): void {
    this.metrics.clear();
    const dir = resolve(this.metricsDir);
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    } catch {
      return; // no directory yet — that's fine
    }
    for (const file of files) {
      const raw = readFileSync(join(dir, file), "utf8");
      const parsed = parse(raw) as RawMetric;
      const spec: MetricSpec = {
        metric: parsed.metric,
        description: parsed.description ?? "",
        dimensions: parsed.dimensions ?? [],
        filters: parsed.filters ?? [],
        sqlTemplate: parsed.sql_template,
        dimensionExpressions: parsed.dimension_expressions,
        guardrails: {
          maxRangeDays: parsed.guardrails?.max_range_days,
          maxRows: parsed.guardrails?.max_rows,
          timeoutSeconds: parsed.guardrails?.timeout_seconds,
        },
      };
      this.metrics.set(spec.metric, spec);
    }
  }

  list(): MetricSpec[] {
    return Array.from(this.metrics.values());
  }

  get(name: string): MetricSpec | undefined {
    return this.metrics.get(name);
  }

  /**
   * Substitute a metric's SQL template with concrete arguments.
   *
   * Templates may contain:
   *   {{dimensions}}        comma-joined dimension list
   *   {{start}} / {{end}}   ISO timestamps quoted as SQL TIMESTAMP literals
   *   {{start_epoch}} / {{end_epoch}}  raw integer literals
   *   {{<filter>_clause}}   AND clause for each declared filter, or empty
   */
  render(name: string, args: MetricRenderArgs): string {
    const spec = this.metrics.get(name);
    if (!spec) throw new Error(`unknown metric: ${name}`);

    let sql = spec.sqlTemplate;
    const dims = (args.dimensions ?? spec.dimensions).filter((d) => spec.dimensions.includes(d));
    const dimExprs = spec.dimensionExpressions ?? {};
    const selectDims = dims.length
      ? dims.map((d) => {
          const expr = dimExprs[d] ?? d;
          return expr === d ? d : `${expr} AS ${d}`;
        }).join(", ")
      : "1";
    const groupDims = dims.length
      ? dims.map((d) => dimExprs[d] ?? d).join(", ")
      : "1";
    // Backwards-compat: the {{dimensions}} placeholder maps to the SELECT form.
    sql = sql.replaceAll("{{select_dimensions}}", selectDims);
    sql = sql.replaceAll("{{group_dimensions}}", groupDims);
    sql = sql.replaceAll("{{dimensions}}", selectDims);

    if (args.start) sql = sql.replaceAll("{{start}}", `TIMESTAMP '${args.start}'`);
    if (args.end) sql = sql.replaceAll("{{end}}", `TIMESTAMP '${args.end}'`);
    if (args.start_epoch != null) sql = sql.replaceAll("{{start_epoch}}", String(args.start_epoch));
    if (args.end_epoch != null) sql = sql.replaceAll("{{end_epoch}}", String(args.end_epoch));

    for (const filter of spec.filters) {
      const placeholder = `{{${filter}_clause}}`;
      const value = args.filters?.[filter];
      if (value == null || value === "") {
        sql = sql.replaceAll(placeholder, "");
      } else if (typeof value === "boolean") {
        sql = sql.replaceAll(placeholder, `AND ${filter} = ${value ? "TRUE" : "FALSE"}`);
      } else if (Array.isArray(value)) {
        const list = value.map((v) => quoteSql(String(v))).join(", ");
        sql = sql.replaceAll(placeholder, `AND ${filter} IN (${list})`);
      } else {
        sql = sql.replaceAll(placeholder, `AND ${filter} = ${quoteSql(String(value))}`);
      }
    }

    return sql;
  }
}

export interface MetricRenderArgs {
  dimensions?: string[];
  filters?: Record<string, string | number | boolean | string[]>;
  start?: string;
  end?: string;
  start_epoch?: number;
  end_epoch?: number;
}

function quoteSql(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

interface RawMetric {
  metric: string;
  description?: string;
  dimensions?: string[];
  filters?: string[];
  sql_template: string;
  dimension_expressions?: Record<string, string>;
  guardrails?: {
    max_range_days?: number;
    max_rows?: number;
    timeout_seconds?: number;
  };
}
