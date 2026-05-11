/**
 * Report writer — emits a polished self-contained HTML file by default,
 * with optional Markdown output for Obsidian / static-site pipelines.
 *
 * The HTML is intentionally single-file: inline CSS, no external fonts, no
 * scripts. It opens cleanly in any browser, prints well, and respects the
 * reader's `prefers-color-scheme`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

export interface ReportSection {
  heading: string;
  /** Free-form prose. Supports minimal inline markdown: `**bold**`, `*em*`, `` `code` ``. Paragraphs are split on blank lines. */
  body?: string;
  /** Array of row objects. Keys of the first row become column headers. */
  table?: Record<string, unknown>[];
  /** Filesystem path or URL to a chart artifact. `.svg`/`.png` render inline; `.html` renders a link; everything else becomes a labelled link. */
  chartPath?: string;
  /** Caption shown under the chart (or as alt text for images). */
  caption?: string;
}

export interface ReportSpec {
  title: string;
  outPath: string;
  frontmatter?: Record<string, unknown>;
  summary?: string;
  sections: ReportSection[];
}

export type ReportFormat = "html" | "markdown";

export function writeReport(spec: ReportSpec, format?: ReportFormat): string {
  const abs = resolve(spec.outPath);
  mkdirSync(dirname(abs), { recursive: true });
  const chosen = format ?? inferFormatFromExt(abs);
  const body = chosen === "markdown" ? renderMarkdown(spec) : renderHtml(spec);
  writeFileSync(abs, body, "utf8");
  return abs;
}

export function inferFormatFromExt(outPath: string): ReportFormat {
  const ext = extname(outPath).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return "html";
}

// ---------------------------------------------------------------- HTML

export function renderHtml(spec: ReportSpec): string {
  const title = escape(spec.title);
  const generated = new Date().toISOString();
  const frontmatter = spec.frontmatter && Object.keys(spec.frontmatter).length > 0
    ? renderFrontmatterHtml(spec.frontmatter)
    : "";
  const summary = spec.summary ? `<p class="summary">${renderInline(spec.summary)}</p>` : "";
  const sections = spec.sections.map(renderSectionHtml).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main class="report">
  <header class="report-head">
    <p class="eyebrow">chainq report</p>
    <h1>${title}</h1>
    <p class="meta">Generated ${escape(generated)}</p>
    ${frontmatter}
    ${summary}
  </header>
  <article>
${sections}
  </article>
  <footer class="report-foot">
    <p>Authored by an AI agent via <a href="https://github.com/Jacksstt/chainq" target="_blank" rel="noopener">chainq</a>. Self-hosted, MCP-native. MIT.</p>
  </footer>
</main>
</body>
</html>
`;
}

function renderSectionHtml(section: ReportSection): string {
  const heading = escape(section.heading);
  const calloutKind = detectCalloutKind(section.heading);
  const wrapperClass = calloutKind ? `section callout callout-${calloutKind}` : "section";
  const parts: string[] = [];
  parts.push(`    <section class="${wrapperClass}">`);
  parts.push(`      <h2>${heading}</h2>`);
  if (section.body) parts.push(`      ${renderBodyHtml(section.body)}`);
  if (section.table && section.table.length > 0) parts.push(`      ${renderTableHtml(section.table)}`);
  if (section.chartPath) parts.push(`      ${renderChartHtml(section.chartPath, section.caption ?? section.heading)}`);
  parts.push(`    </section>`);
  return parts.join("\n");
}

function renderBodyHtml(body: string): string {
  // Split on blank lines into paragraphs, then render inline.
  const paragraphs = body.trim().split(/\n\s*\n/);
  return paragraphs
    .map((p) => `<p>${renderInline(p)}</p>`)
    .join("\n      ");
}

function renderInline(text: string): string {
  // Escape first, then re-introduce a tiny markdown subset. We must escape
  // before regex-substituting tags or `**foo**` -> <strong> would emit a
  // literal `<` in the source.
  let s = escape(text);
  // `code` — non-greedy, no nested backticks
  s = s.replace(/`([^`]+)`/g, (_, c: string) => `<code>${c}</code>`);
  // **bold** — two stars, non-greedy
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, c: string) => `<strong>${c}</strong>`);
  // *italic* — one star, no leading/trailing whitespace
  s = s.replace(/(^|\s)\*([^*\s][^*]*[^*\s]|\S)\*(?=\s|$)/g, (_, pre: string, c: string) => `${pre}<em>${c}</em>`);
  // bare URLs → links
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener">${m}</a>`);
  // single newlines inside a paragraph → <br>
  s = s.replace(/\n/g, "<br>");
  return s;
}

function renderTableHtml(rows: Record<string, unknown>[]): string {
  const first = rows[0]!;
  const keys = Object.keys(first);
  const head = keys.map((k) => `<th>${escape(k)}</th>`).join("");
  const numericCol = (k: string) =>
    rows.every((r) => r[k] == null || typeof r[k] === "number" || typeof r[k] === "bigint" || /^-?[\d,.]+$/.test(String(r[k])));
  const isNum = Object.fromEntries(keys.map((k) => [k, numericCol(k)]));
  const body = rows
    .map((row) => {
      const cells = keys
        .map((k) => `<td${isNum[k] ? " class=\"num\"" : ""}>${escape(formatCell(row[k]))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n        ");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>
        ${body}
      </tbody></table></div>`;
}

function renderChartHtml(chartPath: string, caption: string): string {
  const ext = extname(chartPath).toLowerCase();
  const safePath = escape(chartPath);
  const safeCaption = escape(caption);
  if (ext === ".svg" || ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") {
    return `<figure><img src="${safePath}" alt="${safeCaption}" loading="lazy"><figcaption>${safeCaption}</figcaption></figure>`;
  }
  if (ext === ".html" || ext === ".htm") {
    return `<figure class="chart-link"><a href="${safePath}" target="_blank" rel="noopener">Open interactive chart: ${escape(basename(chartPath))}</a><figcaption>${safeCaption}</figcaption></figure>`;
  }
  return `<figure class="chart-link"><a href="${safePath}" target="_blank" rel="noopener">${escape(basename(chartPath))}</a><figcaption>${safeCaption}</figcaption></figure>`;
}

function renderFrontmatterHtml(frontmatter: Record<string, unknown>): string {
  const rows = Object.entries(frontmatter)
    .map(([k, v]) => `<tr><th scope="row">${escape(k)}</th><td>${escape(formatFrontmatterValue(v))}</td></tr>`)
    .join("");
  return `<details class="frontmatter"><summary>Metadata · ${Object.keys(frontmatter).length} field${Object.keys(frontmatter).length === 1 ? "" : "s"}</summary><table>${rows}</table></details>`;
}

function detectCalloutKind(heading: string): "caveat" | "warning" | "tip" | null {
  const h = heading.toLowerCase().trim();
  if (/^(caveats?|notes?|gotchas?|limitations?)\b/.test(h)) return "caveat";
  if (/^(warning|important|danger)\b/.test(h)) return "warning";
  if (/^(tip|note|aside)\b/.test(h)) return "tip";
  return null;
}

// ---------------------------------------------------------------- Markdown (back-compat)

export function renderMarkdown(spec: ReportSpec): string {
  const out: string[] = [];
  if (spec.frontmatter && Object.keys(spec.frontmatter).length > 0) {
    out.push("---");
    for (const [k, v] of Object.entries(spec.frontmatter)) {
      out.push(`${k}: ${formatFrontmatterValue(v)}`);
    }
    out.push("---", "");
  }

  out.push(`# ${spec.title}`, "");
  if (spec.summary) out.push(spec.summary, "");

  for (const section of spec.sections) {
    out.push(`## ${section.heading}`, "");
    if (section.body) out.push(section.body, "");
    if (section.table && section.table.length > 0) {
      out.push(renderTableMarkdown(section.table), "");
    }
    if (section.chartPath) {
      const caption = section.caption ?? section.heading;
      out.push(`![${caption}](${section.chartPath})`, "");
    }
  }

  return out.join("\n");
}

function renderTableMarkdown(rows: Record<string, unknown>[]): string {
  const first = rows[0];
  if (!first) return "";
  const keys = Object.keys(first);
  const head = `| ${keys.join(" | ")} |`;
  const sep = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${keys.map((k) => formatCellMarkdown(row[k])).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

function formatCellMarkdown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.replace(/\|/g, "\\|");
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

// ---------------------------------------------------------------- shared helpers

function formatCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isInteger(value) ? value.toString() : value.toFixed(4);
  return String(value);
}

function formatFrontmatterValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

// ---------------------------------------------------------------- CSS

const REPORT_CSS = `
:root {
  --bg: #ffffff;
  --bg-soft: #f6f7f9;
  --bg-card: #ffffff;
  --border: #e2e6ee;
  --border-soft: #eef0f4;
  --fg: #0f172a;
  --fg-dim: #475569;
  --fg-mute: #6b7280;
  --accent: #2563eb;
  --accent-soft: #dbeafe;
  --code-bg: #f3f4f6;
  --callout-caveat: #f59e0b;
  --callout-caveat-bg: #fffbeb;
  --callout-warning: #ef4444;
  --callout-warning-bg: #fef2f2;
  --callout-tip: #10b981;
  --callout-tip-bg: #ecfdf5;
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.04);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0c10;
    --bg-soft: #111319;
    --bg-card: #14161d;
    --border: #232631;
    --border-soft: #1a1d25;
    --fg: #e8eaed;
    --fg-dim: #a8adb8;
    --fg-mute: #7d8392;
    --accent: #60a5fa;
    --accent-soft: #1e3a8a;
    --code-bg: #0f1116;
    --callout-caveat: #fbbf24;
    --callout-caveat-bg: #1f1a0a;
    --callout-warning: #f87171;
    --callout-warning-bg: #1f0f0f;
    --callout-tip: #34d399;
    --callout-tip-bg: #0a1f17;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.4);
  }
}
@media print {
  :root {
    --bg: #ffffff; --bg-soft: #ffffff; --bg-card: #ffffff;
    --border: #cccccc; --border-soft: #e5e5e5;
    --fg: #000000; --fg-dim: #333333; --fg-mute: #555555;
    --shadow: none;
  }
  .report-foot, .frontmatter summary { color: #555; }
  .report { max-width: none; padding: 0; }
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); }
body {
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", sans-serif;
  font-size: 16px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre, kbd, samp {
  font-family: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
}
code {
  background: var(--code-bg);
  padding: 0.1em 0.4em;
  border-radius: 4px;
  border: 1px solid var(--border-soft);
}

.report { max-width: 820px; margin: 0 auto; padding: 48px 28px 96px; }

.report-head { border-bottom: 1px solid var(--border-soft); padding-bottom: 24px; margin-bottom: 32px; }
.eyebrow { color: var(--fg-mute); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 8px; font-weight: 600; }
.report-head h1 { font-size: 32px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.01em; }
.meta { color: var(--fg-mute); font-size: 13px; font-family: "SF Mono", Menlo, Consolas, monospace; margin: 0 0 16px; }
.summary { font-size: 18px; line-height: 1.55; color: var(--fg-dim); margin: 16px 0 0; }

.frontmatter { margin: 12px 0 0; font-size: 13px; }
.frontmatter summary { cursor: pointer; color: var(--fg-mute); padding: 4px 0; user-select: none; }
.frontmatter[open] summary { color: var(--fg-dim); margin-bottom: 8px; }
.frontmatter table { width: 100%; border-collapse: collapse; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 12.5px; }
.frontmatter th, .frontmatter td { padding: 4px 12px 4px 0; text-align: left; vertical-align: top; }
.frontmatter th { color: var(--fg-mute); font-weight: 500; width: 1%; white-space: nowrap; }
.frontmatter td { color: var(--fg); }

article { margin: 0; }
.section { margin: 0 0 40px; }
.section h2 {
  font-size: 22px;
  line-height: 1.3;
  margin: 0 0 12px;
  letter-spacing: -0.005em;
}
.section p { margin: 0 0 12px; }
.section p:last-child { margin-bottom: 0; }

.callout {
  background: var(--callout-caveat-bg);
  border-left: 3px solid var(--callout-caveat);
  padding: 16px 20px;
  border-radius: 0 6px 6px 0;
}
.callout-caveat { background: var(--callout-caveat-bg); border-left-color: var(--callout-caveat); }
.callout-warning { background: var(--callout-warning-bg); border-left-color: var(--callout-warning); }
.callout-tip { background: var(--callout-tip-bg); border-left-color: var(--callout-tip); }
.callout h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--callout-caveat); margin: 0 0 8px; }
.callout-warning h2 { color: var(--callout-warning); }
.callout-tip h2 { color: var(--callout-tip); }
.callout p { font-size: 15px; }

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: var(--shadow);
  margin: 8px 0 16px;
}
.table-wrap table {
  width: 100%;
  border-collapse: collapse;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px;
}
.table-wrap thead th {
  text-align: left;
  background: var(--bg-soft);
  color: var(--fg-dim);
  font-weight: 600;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  white-space: nowrap;
}
.table-wrap tbody td {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-soft);
  white-space: nowrap;
}
.table-wrap tbody tr:last-child td { border-bottom: 0; }
.table-wrap tbody tr:nth-child(even) td { background: var(--bg-soft); }
.table-wrap td.num { text-align: right; font-variant-numeric: tabular-nums; }

figure { margin: 16px 0; padding: 0; }
figure img {
  display: block;
  max-width: 100%;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: var(--shadow);
}
figcaption {
  color: var(--fg-mute);
  font-size: 13px;
  margin-top: 8px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
}
.chart-link {
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  background: var(--bg-soft);
}
.chart-link a { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 14px; }

.report-foot {
  margin-top: 64px;
  padding-top: 24px;
  border-top: 1px solid var(--border-soft);
  color: var(--fg-mute);
  font-size: 13px;
}
.report-foot a { color: var(--fg-mute); text-decoration: underline; text-decoration-color: var(--border); }
.report-foot a:hover { color: var(--accent); text-decoration-color: var(--accent); }

@media (max-width: 640px) {
  .report { padding: 32px 18px 64px; }
  .report-head h1 { font-size: 26px; }
  .section h2 { font-size: 20px; }
  .summary { font-size: 16px; }
}
`;
