/**
 * Chart rendering via vega-lite.
 *
 * The chart spec is generated from a result-set + a chart type and rendered
 * to SVG with vega's headless renderer. We deliberately avoid node-canvas
 * so the package stays pure-JS and easy to install on CI / Linux.
 */

import * as vega from "vega";
import * as vegaLite from "vega-lite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ChartType = "line" | "bar" | "area" | "point";

export interface ChartSpec {
  type: ChartType;
  data: Record<string, unknown>[];
  x: string;
  y: string;
  color?: string;
  title?: string;
  width?: number;
  height?: number;
}

export async function renderChartSvg(spec: ChartSpec): Promise<string> {
  const vlSpec: vegaLite.TopLevelSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    title: spec.title,
    width: spec.width ?? 600,
    height: spec.height ?? 320,
    data: { values: spec.data },
    mark: spec.type === "point" ? "point" : spec.type,
    encoding: {
      x: { field: spec.x, type: inferType(spec.data, spec.x) },
      y: { field: spec.y, type: "quantitative" },
      ...(spec.color
        ? { color: { field: spec.color, type: inferType(spec.data, spec.color) } }
        : {}),
    },
  };

  const compiled = vegaLite.compile(vlSpec).spec;
  const runtime = vega.parse(compiled);
  const view = new vega.View(runtime, { renderer: "none" });
  return view.toSVG();
}

export async function saveChart(spec: ChartSpec, outPath: string): Promise<string> {
  const svg = await renderChartSvg(spec);
  const abs = resolve(outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, svg, "utf8");
  return abs;
}

function inferType(
  data: Record<string, unknown>[],
  field: string,
): "quantitative" | "nominal" | "temporal" {
  const v = data[0]?.[field];
  if (v == null) return "nominal";
  if (typeof v === "number") return "quantitative";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return "temporal";
  if (v instanceof Date) return "temporal";
  return "nominal";
}
