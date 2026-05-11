/**
 * Chart rendering via vega-lite.
 *
 * The chart spec is generated from a result-set + a chart type and rendered
 * to SVG with vega's headless renderer (no node-canvas, stays pure-JS).
 *
 * Four output formats are supported:
 *   - "svg"           — headless SVG string (the original behavior).
 *   - "html"          — single-file HTML that loads vega/vega-lite/vega-embed
 *                       from a CDN and renders the spec client-side. Useful
 *                       for interactive charts shared as static files.
 *   - "vegalite-json" — the raw vega-lite TopLevelSpec, pretty-printed.
 *                       Lets downstream tools re-style or re-render.
 *   - "png"           — rasterized via @resvg/resvg-js (pure-JS / WASM-ish,
 *                       no native canvas). Returns/writes binary PNG bytes,
 *                       suitable for embedding in slide decks, social cards,
 *                       PDFs, or Markdown for Obsidian / GitHub.
 */

import * as vega from "vega";
import * as vegaLite from "vega-lite";
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

export type ChartType = "line" | "bar" | "area" | "point";
export type ChartFormat = "svg" | "html" | "vegalite-json" | "png";

export interface PngOptions {
  /** Output pixel width. SVG is scaled to fit. Default: spec.width or 600. */
  pngWidth?: number;
  /** Pixel-density multiplier. Use 2 for retina. Default 1. */
  pngScale?: number;
  /** Optional CSS background applied behind the chart. Default `#ffffff`. */
  pngBackground?: string;
}

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
 * Render a chart to a PNG buffer. Internally rasterizes the SVG output via
 * `@resvg/resvg-js` — no native canvas dependency, works the same on macOS,
 * Linux, and CI runners.
 */
export async function renderChartPng(
  spec: ChartSpec,
  opts: PngOptions = {},
): Promise<Uint8Array> {
  const svg = await renderChartSvg(spec);
  const width = opts.pngWidth ?? spec.width ?? 600;
  const scale = Math.max(0.5, Math.min(4, opts.pngScale ?? 1));
  const background = opts.pngBackground ?? "#ffffff";
  const resvg = new Resvg(svg, {
    background,
    fitTo: { mode: "width", value: Math.round(width * scale) },
    font: {
      // resvg-js cannot load system fonts by default on every platform;
      // disabling font-loading lets the rasterizer use its built-in
      // fallback. Vega's default font is "sans-serif" which resvg
      // handles fine with the built-in glyphs.
      loadSystemFonts: true,
    },
  });
  return resvg.render().asPng();
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
  opts: PngOptions = {},
): Promise<string> {
  const abs = resolve(outPath);
  const chosen = format ?? inferFormatFromExt(abs) ?? "svg";
  mkdirSync(dirname(abs), { recursive: true });
  if (chosen === "png") {
    const bytes = await renderChartPng(spec, opts);
    writeFileSync(abs, bytes);
  } else {
    const body = await renderChartTextFormat(spec, chosen);
    writeFileSync(abs, body, "utf8");
  }
  return abs;
}

async function renderChartTextFormat(spec: ChartSpec, format: Exclude<ChartFormat, "png">): Promise<string> {
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
  if (ext === ".png") return "png";
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
