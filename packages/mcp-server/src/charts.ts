/**
 * Chart rendering via vega-lite.
 *
 * The chart spec is generated from a result-set + a chart type and rendered
 * to SVG with vega's headless renderer. We deliberately avoid node-canvas
 * so the package stays pure-JS and easy to install on CI / Linux.
 *
 * Three output formats are supported:
 *   - "svg"           — headless SVG string (the original behavior).
 *   - "html"          — single-file HTML that loads vega/vega-lite/vega-embed
 *                       from a CDN and renders the spec client-side. Useful
 *                       for interactive charts shared as static files.
 *   - "vegalite-json" — the raw vega-lite TopLevelSpec, pretty-printed.
 *                       Lets downstream tools re-style or re-render.
 */

import * as vega from "vega";
import * as vegaLite from "vega-lite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

export type ChartType = "line" | "bar" | "area" | "point";
export type ChartFormat = "svg" | "html" | "vegalite-json";

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

/**
 * Build the vega-lite TopLevelSpec from a ChartSpec. Single source of truth
 * for the spec shape — every renderer below funnels through here.
 */
export function buildVegaLiteSpec(spec: ChartSpec): vegaLite.TopLevelSpec {
  return {
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
}

export async function renderChartSvg(spec: ChartSpec): Promise<string> {
  const vlSpec = buildVegaLiteSpec(spec);
  const compiled = vegaLite.compile(vlSpec).spec;
  const runtime = vega.parse(compiled);
  const view = new vega.View(runtime, { renderer: "none" });
  return view.toSVG();
}

/**
 * Render a single-file HTML document that loads vega / vega-lite / vega-embed
 * from a CDN and embeds the vega-lite spec. The resulting file is portable
 * (open it in any browser) and interactive (tooltips, panning where applicable).
 */
export function renderChartHtml(spec: ChartSpec): string {
  const vlSpec = buildVegaLiteSpec(spec);
  // Defeat any "</script>" sequence smuggled into the data values so that the
  // serialized JSON cannot break out of the inline <script> block.
  const safeJson = JSON.stringify(vlSpec).replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html><head>
  <meta charset="utf-8" />
  <title>chainq chart</title>
  <script src="https://cdn.jsdelivr.net/npm/vega@5"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-lite@6"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-embed@6"></script>
</head><body>
  <div id="chart"></div>
  <script>
    const spec = ${safeJson};
    vegaEmbed("#chart", spec, { actions: false });
  </script>
</body></html>
`;
}

/**
 * Return the vega-lite TopLevelSpec as pretty-printed JSON. Useful for
 * round-tripping into Vega Editor or other tooling.
 */
export function renderChartVegaLiteJson(spec: ChartSpec): string {
  return JSON.stringify(buildVegaLiteSpec(spec), null, 2);
}

/**
 * Persist a chart to disk. Format selection rules:
 *   1. If `format` is passed, use it.
 *   2. Else infer from the file extension (.svg / .html / .json).
 *   3. Else fall back to "svg" (back-compat with the original signature).
 *
 * Returns the absolute path written.
 */
export async function saveChart(
  spec: ChartSpec,
  outPath: string,
  format?: ChartFormat,
): Promise<string> {
  const abs = resolve(outPath);
  const chosen = format ?? inferFormatFromExt(abs) ?? "svg";
  const body = await renderChartFormat(spec, chosen);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
  return abs;
}

async function renderChartFormat(spec: ChartSpec, format: ChartFormat): Promise<string> {
  switch (format) {
    case "svg":
      return renderChartSvg(spec);
    case "html":
      return renderChartHtml(spec);
    case "vegalite-json":
      return renderChartVegaLiteJson(spec);
    default: {
      const _exhaustive: never = format;
      throw new Error(`unsupported chart format: ${String(_exhaustive)}`);
    }
  }
}

export function inferFormatFromExt(path: string): ChartFormat | undefined {
  const ext = extname(path).toLowerCase();
  if (ext === ".svg") return "svg";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".json") return "vegalite-json";
  return undefined;
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
