/**
 * chainq chart theme.
 *
 * Vega-lite's defaults are ugly: chunky blue bars on white, Helvetica fallback
 * fonts, heavy gridlines, no SI-prefix formatting. We replace them with a
 * refined palette / typography / spacing system that matches the report
 * chrome and respects the reader's `prefers-color-scheme`.
 *
 * The palette is a curated set of 8 colors that look intentional next to
 * each other (not just rainbow), survive being printed grayscale (each has
 * distinct luminance), and remain readable for users with deuteranopia
 * (no red-green confusion in adjacent positions).
 */

import type { Config } from "vega-lite";

export type ChartThemeName = "light" | "dark" | "auto";

/** Curated 8-color categorical palette. Order chosen so neighbours are distinguishable. */
const PALETTE = [
  "#2563eb", // indigo-600 — primary blue
  "#10b981", // emerald-500 — green
  "#f59e0b", // amber-500 — gold
  "#ef4444", // red-500 — alert red
  "#8b5cf6", // violet-500 — purple
  "#06b6d4", // cyan-500 — teal
  "#ec4899", // pink-500 — magenta
  "#84cc16", // lime-500 — lime
];

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'Helvetica Neue', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans CJK JP', sans-serif";
const FONT_MONO = "'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

export const LIGHT_THEME: Config = {
  background: "transparent",
  font: FONT_STACK,
  padding: { top: 12, right: 16, bottom: 12, left: 12 },
  view: { stroke: "transparent" },
  axis: {
    domain: false,
    domainColor: "#e2e6ee",
    gridColor: "#eef0f4",
    gridDash: [2, 4],
    gridWidth: 0.8,
    tickColor: "#e2e6ee",
    tickSize: 4,
    labelColor: "#64748b",
    labelFont: FONT_MONO,
    labelFontSize: 11,
    labelPadding: 6,
    titleColor: "#0f172a",
    titleFont: FONT_STACK,
    titleFontSize: 12,
    titleFontWeight: 600,
    titlePadding: 12,
    labelOverlap: "parity",
  },
  legend: {
    labelFont: FONT_STACK,
    labelColor: "#475569",
    labelFontSize: 11,
    titleColor: "#0f172a",
    titleFontSize: 12,
    titleFontWeight: 600,
    symbolType: "square",
    symbolSize: 80,
    rowPadding: 4,
  },
  title: {
    color: "#0f172a",
    font: FONT_STACK,
    fontSize: 14,
    fontWeight: 600,
    anchor: "start",
    offset: 16,
    subtitleColor: "#475569",
    subtitleFont: FONT_STACK,
    subtitleFontSize: 12,
  },
  range: {
    category: PALETTE,
    ramp: { scheme: "blues" },
    diverging: { scheme: "redblue" },
  },
  bar: {
    cornerRadiusEnd: 3,
    color: PALETTE[0]!,
  },
  line: {
    strokeWidth: 2.5,
    color: PALETTE[0]!,
  },
  point: {
    size: 64,
    filled: true,
    color: PALETTE[0]!,
  },
  area: {
    fillOpacity: 0.18,
    line: { strokeWidth: 2 },
    color: PALETTE[0]!,
  },
  arc: {
    innerRadius: 56,
    padAngle: 0.01,
    cornerRadius: 2,
  },
  rect: {
    color: PALETTE[0]!,
  },
};

export const DARK_THEME: Config = {
  ...LIGHT_THEME,
  background: "transparent",
  view: { stroke: "transparent" },
  axis: {
    ...LIGHT_THEME.axis,
    domainColor: "#232631",
    gridColor: "#1a1d25",
    tickColor: "#232631",
    labelColor: "#94a3b8",
    titleColor: "#e8eaed",
  },
  legend: {
    ...LIGHT_THEME.legend,
    labelColor: "#94a3b8",
    titleColor: "#e8eaed",
  },
  title: {
    ...LIGHT_THEME.title,
    color: "#e8eaed",
    subtitleColor: "#94a3b8",
  },
  range: {
    // Slightly brighter palette on dark backgrounds.
    category: [
      "#60a5fa", "#34d399", "#fbbf24", "#f87171",
      "#a78bfa", "#22d3ee", "#f472b6", "#a3e635",
    ],
    ramp: { scheme: "blues" },
    diverging: { scheme: "redblue" },
  },
};

export function pickTheme(name: ChartThemeName = "light"): Config {
  return name === "dark" ? DARK_THEME : LIGHT_THEME;
}

/**
 * SI-prefix numeric axis format, applied via vega-lite's `axis.labelExpr`.
 * Turns 28529 → "28.5k", 1610000 → "1.61M", 0.0042 → "4.2m".
 *
 * Use as `{ axis: { labelExpr: SI_FORMAT } }` on a quantitative encoding.
 */
export const SI_FORMAT_EXPR = "format(datum.value, '~s')";

/** Compact comma-thousand format. Use for axes where SI suffix would be confusing. */
export const COMMA_FORMAT_EXPR = "format(datum.value, ',')";
