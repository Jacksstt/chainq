/**
 * Report writer — emits a polished self-contained HTML file by default,
 * with optional Markdown output for Obsidian / static-site pipelines.
 *
 * Bilingual support: title / summary / section headings / bodies / captions
 * accept `string | { en, ja }`. The `locale` field on ReportSpec picks the
 * rendering mode:
 *   - "en"   → English only (default; back-compat)
 *   - "ja"   → Japanese only
 *   - "both" → bilingual HTML with a CSS-only language toggle (no JS)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

export interface I18nString {
  en?: string;
  ja?: string;
}

export type Localizable = string | I18nString;

export type ReportLocale = "en" | "ja" | "both";

export interface DownloadLink {
  /** Relative path or URL of the artefact. */
  path: string;
  /** Display label. Defaults to `basename(path)`. */
  label?: Localizable;
  /** Hint about file type. Affects the chip styling, not download behaviour. */
  format?: "csv" | "json" | "parquet" | "html" | "svg" | "png" | "other";
}

export interface ReportSection {
  heading: Localizable;
  body?: Localizable;
  table?: Record<string, unknown>[];
  chartPath?: string;
  caption?: Localizable;
  /** Optional download chips rendered under the section (CSV / JSON / Parquet …). */
  downloads?: DownloadLink[];
  /**
   * For interactive HTML charts: `chartPath` can already point at a `.html`
   * artefact, in which case it is embedded via `<iframe>` (sandboxed). Set
   * `chartHeight` to control iframe height; default 360px.
   */
  chartHeight?: number;
}

export interface ReportBrand {
  /** Overrides the "chainq report" eyebrow text and footer attribution. */
  name?: string;
  /** URL or relative path to a logo image (SVG / PNG). Rendered in the header. */
  logoUrl?: string;
  /** Any valid CSS color. Overrides the report's --accent token. */
  accentColor?: string;
  /** Custom footer line (replaces the default attribution string). */
  footer?: Localizable;
}

export interface ReportSpec {
  title: Localizable;
  outPath: string;
  frontmatter?: Record<string, unknown>;
  summary?: Localizable;
  sections: ReportSection[];
  /** "en" / "ja" / "both". Defaults to "en" for back-compat. */
  locale?: ReportLocale;
  /** Optional brand overrides (logo / accent / footer). */
  brand?: ReportBrand;
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

// ---------------------------------------------------------------- locale helpers

function isI18n(v: unknown): v is I18nString {
  return typeof v === "object" && v !== null && !Array.isArray(v) &&
    ("en" in (v as Record<string, unknown>) || "ja" in (v as Record<string, unknown>));
}

function pick(v: Localizable | undefined, lang: "en" | "ja"): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return v[lang] ?? v.en ?? v.ja ?? "";
}

function hasI18n(spec: ReportSpec): boolean {
  if (isI18n(spec.title)) return true;
  if (spec.summary && isI18n(spec.summary)) return true;
  for (const s of spec.sections) {
    if (isI18n(s.heading)) return true;
    if (s.body && isI18n(s.body)) return true;
    if (s.caption && isI18n(s.caption)) return true;
  }
  return false;
}

// Chrome strings (the report's own UI text) per locale.
interface Chrome {
  generated: (iso: string) => string;
  metadata: (n: number) => string;
  openChart: string;
  authoredBy: string;
  mit: string;
}

const CHROME: Record<"en" | "ja", Chrome> = {
  en: {
    generated: (iso) => `Generated ${iso}`,
    metadata: (n) => `Metadata · ${n} field${n === 1 ? "" : "s"}`,
    openChart: "Open interactive chart",
    authoredBy: "Authored by an AI agent via",
    mit: "Self-hosted, MCP-native. MIT.",
  },
  ja: {
    generated: (iso) => `生成: ${iso}`,
    metadata: (n) => `メタデータ · ${n} 項目`,
    openChart: "インタラクティブチャートを開く",
    authoredBy: "AIエージェントが",
    mit: "セルフホスト、MCPネイティブ、MITライセンス。",
  },
};

// ---------------------------------------------------------------- HTML

export function renderHtml(spec: ReportSpec): string {
  const requestedLocale = spec.locale ?? "en";
  // "both" only makes sense when at least one field is bilingual.
  const locale: ReportLocale = requestedLocale === "both" && !hasI18n(spec)
    ? "en"
    : requestedLocale;

  if (locale === "both") return renderHtmlBilingual(spec);
  return renderHtmlSingle(spec, locale);
}

function renderHtmlSingle(spec: ReportSpec, lang: "en" | "ja"): string {
  const title = escape(pick(spec.title, lang));
  const generated = new Date().toISOString();
  const chrome = CHROME[lang];
  const brand = spec.brand ?? {};
  const eyebrow = escape(brand.name ?? "chainq report");
  const brandStyle = brand.accentColor
    ? `<style>:root, .report { --accent: ${escape(brand.accentColor)}; }</style>`
    : "";
  const logo = brand.logoUrl
    ? `<img class="report-logo" src="${escape(brand.logoUrl)}" alt="">`
    : "";
  const footerText = pick(brand.footer, lang);

  const frontmatter = spec.frontmatter && Object.keys(spec.frontmatter).length > 0
    ? renderFrontmatter(spec.frontmatter, chrome)
    : "";
  const summaryText = pick(spec.summary, lang);
  const summary = summaryText ? `<p class="summary">${renderInline(summaryText)}</p>` : "";
  const sections = spec.sections
    .map((s) => renderSectionSingle(s, lang))
    .join("\n");

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${REPORT_CSS}</style>${brandStyle}
</head>
<body>
<main class="report">
  <header class="report-head">
    ${logo}
    <p class="eyebrow">${eyebrow}</p>
    <h1>${title}</h1>
    <p class="meta">${escape(chrome.generated(generated))}</p>
    ${frontmatter}
    ${summary}
  </header>
  <article>
${sections}
  </article>
  <footer class="report-foot">
    <p>${footerText ? renderInline(footerText) : `${escape(chrome.authoredBy)} <a href="https://github.com/Jacksstt/chainq" target="_blank" rel="noopener">chainq</a>. ${escape(chrome.mit)}`}</p>
  </footer>
</main>
</body>
</html>
`;
}

function renderHtmlBilingual(spec: ReportSpec): string {
  const titleEn = escape(pick(spec.title, "en"));
  const titleJa = escape(pick(spec.title, "ja"));
  const generated = new Date().toISOString();
  const brand = spec.brand ?? {};
  const eyebrow = escape(brand.name ?? "chainq report");
  const brandStyle = brand.accentColor
    ? `<style>:root, .report { --accent: ${escape(brand.accentColor)}; }</style>`
    : "";
  const logo = brand.logoUrl
    ? `<img class="report-logo" src="${escape(brand.logoUrl)}" alt="">`
    : "";
  const footerJa = pick(brand.footer, "ja");
  const footerEn = pick(brand.footer, "en");

  const frontmatterBlock = spec.frontmatter && Object.keys(spec.frontmatter).length > 0
    ? renderFrontmatterBilingual(spec.frontmatter)
    : "";
  const summaryEn = pick(spec.summary, "en");
  const summaryJa = pick(spec.summary, "ja");
  const summary = (summaryEn || summaryJa)
    ? `${summaryJa ? `<p class="summary" lang="ja">${renderInline(summaryJa)}</p>` : ""}${summaryEn ? `<p class="summary" lang="en">${renderInline(summaryEn)}</p>` : ""}`
    : "";

  const sections = spec.sections.map(renderSectionBilingual).join("\n");

  // Title for <title> tag: prefer Japanese if available, else English.
  const docTitle = titleJa || titleEn;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${docTitle}</title>
<style>${REPORT_CSS}${BILINGUAL_CSS}</style>${brandStyle}
</head>
<body>
<input id="loc-ja" type="radio" name="locale" checked aria-hidden="true">
<input id="loc-en" type="radio" name="locale" aria-hidden="true">
<main class="report" data-bilingual>
  <nav class="locale-switch" aria-label="言語 / Language">
    <label for="loc-ja">日本語</label>
    <label for="loc-en">English</label>
  </nav>
  <header class="report-head">
    ${logo}
    <p class="eyebrow">${eyebrow}</p>
    ${titleJa ? `<h1 lang="ja">${titleJa}</h1>` : ""}
    ${titleEn ? `<h1 lang="en">${titleEn}</h1>` : ""}
    <p class="meta" lang="ja">${escape(CHROME.ja.generated(generated))}</p>
    <p class="meta" lang="en">${escape(CHROME.en.generated(generated))}</p>
    ${frontmatterBlock}
    ${summary}
  </header>
  <article>
${sections}
  </article>
  <footer class="report-foot">
    <p lang="ja">${footerJa ? renderInline(footerJa) : `${escape(CHROME.ja.authoredBy)} <a href="https://github.com/Jacksstt/chainq" target="_blank" rel="noopener">chainq</a> ${escape("経由で作成")}。${escape(CHROME.ja.mit)}`}</p>
    <p lang="en">${footerEn ? renderInline(footerEn) : `${escape(CHROME.en.authoredBy)} <a href="https://github.com/Jacksstt/chainq" target="_blank" rel="noopener">chainq</a>. ${escape(CHROME.en.mit)}`}</p>
  </footer>
</main>
</body>
</html>
`;
}

function renderSectionSingle(section: ReportSection, lang: "en" | "ja"): string {
  const headingText = pick(section.heading, lang);
  const heading = escape(headingText);
  const callout = detectCallout(headingText);
  const wrapperClass = callout ? `section callout callout-${callout}` : "section";
  const parts: string[] = [];
  parts.push(`    <section class="${wrapperClass}">`);
  parts.push(`      <h2>${heading}</h2>`);
  const bodyText = pick(section.body, lang);
  if (bodyText) parts.push(`      ${renderBody(bodyText)}`);
  if (section.table && section.table.length > 0) parts.push(`      ${renderTable(section.table)}`);
  if (section.chartPath) {
    parts.push(`      ${renderChart(section.chartPath, pick(section.caption, lang) || headingText, section.chartHeight)}`);
  }
  if (section.downloads && section.downloads.length > 0) {
    parts.push(`      ${renderDownloads(section.downloads, lang)}`);
  }
  parts.push(`    </section>`);
  return parts.join("\n");
}

function renderSectionBilingual(section: ReportSection): string {
  const headingJa = pick(section.heading, "ja");
  const headingEn = pick(section.heading, "en");
  // Detect callout from EITHER locale's heading.
  const callout = detectCallout(headingJa) ?? detectCallout(headingEn);
  const wrapperClass = callout ? `section callout callout-${callout}` : "section";

  const parts: string[] = [];
  parts.push(`    <section class="${wrapperClass}">`);
  if (headingJa) parts.push(`      <h2 lang="ja">${escape(headingJa)}</h2>`);
  if (headingEn) parts.push(`      <h2 lang="en">${escape(headingEn)}</h2>`);

  const bodyJa = pick(section.body, "ja");
  const bodyEn = pick(section.body, "en");
  if (bodyJa) parts.push(`      <div lang="ja">${renderBody(bodyJa)}</div>`);
  if (bodyEn) parts.push(`      <div lang="en">${renderBody(bodyEn)}</div>`);

  if (section.table && section.table.length > 0) parts.push(`      ${renderTable(section.table)}`);

  if (section.chartPath) {
    const captionJa = pick(section.caption, "ja") || headingJa;
    const captionEn = pick(section.caption, "en") || headingEn;
    parts.push(`      ${renderChartBilingual(section.chartPath, captionJa, captionEn, section.chartHeight)}`);
  }
  if (section.downloads && section.downloads.length > 0) {
    parts.push(`      ${renderDownloadsBilingual(section.downloads)}`);
  }
  parts.push(`    </section>`);
  return parts.join("\n");
}

function renderBody(body: string): string {
  const paragraphs = body.trim().split(/\n\s*\n/);
  return paragraphs.map((p) => `<p>${renderInline(p)}</p>`).join("\n      ");
}

function renderInline(text: string): string {
  let s = escape(text);
  s = s.replace(/`([^`]+)`/g, (_, c: string) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, c: string) => `<strong>${c}</strong>`);
  s = s.replace(/(^|\s)\*([^*\s][^*]*[^*\s]|\S)\*(?=\s|$)/g, (_, pre: string, c: string) => `${pre}<em>${c}</em>`);
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener">${m}</a>`);
  s = s.replace(/\n/g, "<br>");
  return s;
}

function renderTable(rows: Record<string, unknown>[]): string {
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

function renderChart(chartPath: string, caption: string, chartHeight = 360): string {
  const ext = extname(chartPath).toLowerCase();
  const safePath = escape(chartPath);
  const safeCaption = escape(caption);
  if (ext === ".svg" || ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") {
    return `<figure><img src="${safePath}" alt="${safeCaption}" loading="lazy"><figcaption>${safeCaption}</figcaption></figure>`;
  }
  if (ext === ".html" || ext === ".htm") {
    // Interactive chart: embed via sandboxed iframe so the vega runtime works
    // in-page. Sandbox keeps it scripted but isolated; allow-popups lets the
    // chart's "View source" / "Export PNG" actions open externally.
    return `<figure class="chart-interactive"><iframe src="${safePath}" title="${safeCaption}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" loading="lazy" style="width:100%; height:${Math.max(120, chartHeight)}px; border:0; border-radius:8px; background:var(--bg-card);"></iframe><figcaption>${safeCaption}</figcaption></figure>`;
  }
  return `<figure class="chart-link"><a href="${safePath}" target="_blank" rel="noopener">${escape(basename(chartPath))}</a><figcaption>${safeCaption}</figcaption></figure>`;
}

function renderChartBilingual(chartPath: string, captionJa: string, captionEn: string, chartHeight = 360): string {
  const ext = extname(chartPath).toLowerCase();
  const safePath = escape(chartPath);
  const altCaption = captionEn || captionJa;
  const imgish = ext === ".svg" || ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp";
  const interactive = ext === ".html" || ext === ".htm";
  let head: string;
  if (imgish) {
    head = `<img src="${safePath}" alt="${escape(altCaption)}" loading="lazy">`;
  } else if (interactive) {
    head = `<iframe src="${safePath}" title="${escape(altCaption)}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" loading="lazy" style="width:100%; height:${Math.max(120, chartHeight)}px; border:0; border-radius:8px; background:var(--bg-card);"></iframe>`;
  } else {
    head = `<a href="${safePath}" target="_blank" rel="noopener">${escape(basename(chartPath))}</a>`;
  }
  const captions: string[] = [];
  if (captionJa) captions.push(`<figcaption lang="ja">${escape(captionJa)}</figcaption>`);
  if (captionEn) captions.push(`<figcaption lang="en">${escape(captionEn)}</figcaption>`);
  const wrapperClass = imgish ? "" : interactive ? " class=\"chart-interactive\"" : " class=\"chart-link\"";
  return `<figure${wrapperClass}>${head}${captions.join("")}</figure>`;
}

function renderDownloads(downloads: DownloadLink[], lang: "en" | "ja"): string {
  return renderDownloadChips(downloads, (d) => pick(d.label, lang) || basename(d.path), "");
}

function renderDownloadsBilingual(downloads: DownloadLink[]): string {
  // Render BOTH locales' labels — CSS will hide the appropriate one.
  const parts = downloads.map((d) => {
    const ja = pick(d.label, "ja") || basename(d.path);
    const en = pick(d.label, "en") || basename(d.path);
    const fmt = (d.format ?? guessFormat(d.path)).toUpperCase();
    return `<a class="dl-chip dl-${escape((d.format ?? guessFormat(d.path)))}" href="${escape(d.path)}" download><span class="dl-fmt">${escape(fmt)}</span> <span lang="ja">${escape(ja)}</span><span lang="en">${escape(en)}</span></a>`;
  });
  return `<div class="downloads">${parts.join("")}</div>`;
}

function renderDownloadChips(
  downloads: DownloadLink[],
  labelFn: (d: DownloadLink) => string,
  _suffix: string,
): string {
  const parts = downloads.map((d) => {
    const fmt = (d.format ?? guessFormat(d.path)).toUpperCase();
    return `<a class="dl-chip dl-${escape((d.format ?? guessFormat(d.path)))}" href="${escape(d.path)}" download><span class="dl-fmt">${escape(fmt)}</span> ${escape(labelFn(d))}</a>`;
  });
  return `<div class="downloads">${parts.join("")}</div>`;
}

function guessFormat(path: string): NonNullable<DownloadLink["format"]> {
  const ext = extname(path).toLowerCase().replace(/^\./, "");
  if (ext === "csv" || ext === "json" || ext === "parquet" || ext === "html" || ext === "svg" || ext === "png") {
    return ext as NonNullable<DownloadLink["format"]>;
  }
  return "other";
}

function renderFrontmatter(frontmatter: Record<string, unknown>, chrome: Chrome): string {
  const rows = Object.entries(frontmatter)
    .map(([k, v]) => `<tr><th scope="row">${escape(k)}</th><td>${escape(formatFrontmatterValue(v))}</td></tr>`)
    .join("");
  return `<details class="frontmatter"><summary>${escape(chrome.metadata(Object.keys(frontmatter).length))}</summary><table>${rows}</table></details>`;
}

function renderFrontmatterBilingual(frontmatter: Record<string, unknown>): string {
  const rows = Object.entries(frontmatter)
    .map(([k, v]) => `<tr><th scope="row">${escape(k)}</th><td>${escape(formatFrontmatterValue(v))}</td></tr>`)
    .join("");
  const n = Object.keys(frontmatter).length;
  return `<details class="frontmatter"><summary><span lang="ja">${escape(CHROME.ja.metadata(n))}</span><span lang="en">${escape(CHROME.en.metadata(n))}</span></summary><table>${rows}</table></details>`;
}

function detectCallout(heading: string): "caveat" | "warning" | "tip" | null {
  const h = heading.toLowerCase().trim();
  // English keywords
  if (/^(caveats?|notes?|gotchas?|limitations?)\b/.test(h)) return "caveat";
  if (/^(warning|important|danger)\b/.test(h)) return "warning";
  if (/^(tip|aside|hint)\b/.test(h)) return "tip";
  // Japanese keywords (no word-boundary; CJK matching).
  if (/^(注意|注意事項|ご注意|注釈|免責|留意|備考|落とし穴)/.test(heading.trim())) return "caveat";
  if (/^(警告|危険|重要)/.test(heading.trim())) return "warning";
  if (/^(ヒント|メモ|補足|参考)/.test(heading.trim())) return "tip";
  return null;
}

// ---------------------------------------------------------------- Markdown (back-compat)

export function renderMarkdown(spec: ReportSpec): string {
  // Markdown output collapses to a single language (the requested locale,
  // defaulting to English). Bilingual readers should use HTML.
  const lang: "en" | "ja" = spec.locale === "ja" ? "ja" : "en";
  const out: string[] = [];
  if (spec.frontmatter && Object.keys(spec.frontmatter).length > 0) {
    out.push("---");
    for (const [k, v] of Object.entries(spec.frontmatter)) {
      out.push(`${k}: ${formatFrontmatterValue(v)}`);
    }
    out.push("---", "");
  }

  out.push(`# ${pick(spec.title, lang)}`, "");
  const summary = pick(spec.summary, lang);
  if (summary) out.push(summary, "");

  for (const section of spec.sections) {
    out.push(`## ${pick(section.heading, lang)}`, "");
    const body = pick(section.body, lang);
    if (body) out.push(body, "");
    if (section.table && section.table.length > 0) {
      out.push(renderTableMarkdown(section.table), "");
    }
    if (section.chartPath) {
      const caption = pick(section.caption, lang) || pick(section.heading, lang);
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
  .locale-switch { display: none; }
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); }
body {
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", sans-serif;
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
.report-head h1 { font-size: 32px; line-height: 1.25; margin: 0 0 8px; letter-spacing: -0.01em; }
.report-head h1 + h1 { margin-top: 4px; font-size: 24px; color: var(--fg-dim); font-weight: 500; }
.meta { color: var(--fg-mute); font-size: 13px; font-family: "SF Mono", Menlo, Consolas, monospace; margin: 0 0 4px; }
.meta + .meta { margin-bottom: 16px; }
.summary { font-size: 18px; line-height: 1.55; color: var(--fg-dim); margin: 16px 0 0; }
.summary + .summary { margin-top: 8px; font-size: 16px; }

.frontmatter { margin: 12px 0 0; font-size: 13px; }
.frontmatter summary { cursor: pointer; color: var(--fg-mute); padding: 4px 0; user-select: none; list-style: none; }
.frontmatter summary::-webkit-details-marker { display: none; }
.frontmatter summary::before { content: "▸ "; display: inline-block; transition: transform 120ms ease; }
.frontmatter[open] summary::before { transform: rotate(90deg); }
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
.section h2 + h2 { margin-top: -4px; font-size: 17px; color: var(--fg-dim); font-weight: 500; }
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
figcaption + figcaption { margin-top: 2px; }
.chart-link {
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  background: var(--bg-soft);
}
.chart-link a { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 14px; }
.chart-interactive { margin: 16px 0; }

.report-logo {
  display: block;
  max-height: 36px;
  margin: 0 0 12px;
}

.downloads {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0 0;
}
.dl-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  background: var(--bg-soft);
  color: var(--fg-dim);
  text-decoration: none;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
}
.dl-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
  text-decoration: none;
  background: var(--bg-card);
}
.dl-fmt {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.dl-csv .dl-fmt    { background: #16a34a22; color: #16a34a; }
.dl-json .dl-fmt   { background: #eab30822; color: #c08303; }
.dl-parquet .dl-fmt{ background: #6366f122; color: #6366f1; }
.dl-html .dl-fmt   { background: #ef444422; color: #ef4444; }

.report-foot {
  margin-top: 64px;
  padding-top: 24px;
  border-top: 1px solid var(--border-soft);
  color: var(--fg-mute);
  font-size: 13px;
}
.report-foot a { color: var(--fg-mute); text-decoration: underline; text-decoration-color: var(--border); }
.report-foot a:hover { color: var(--accent); text-decoration-color: var(--accent); }
.report-foot p + p { margin-top: 2px; }

@media (max-width: 640px) {
  .report { padding: 32px 18px 64px; }
  .report-head h1 { font-size: 26px; }
  .report-head h1 + h1 { font-size: 19px; }
  .section h2 { font-size: 20px; }
  .section h2 + h2 { font-size: 15px; }
  .summary { font-size: 16px; }
}
`;

const BILINGUAL_CSS = `
/* Bilingual: CSS-only locale toggle. Default = Japanese visible. */
input[type="radio"][name="locale"] {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 0;
  height: 0;
}
.locale-switch {
  display: inline-flex;
  gap: 4px;
  margin: 0 0 24px;
  padding: 4px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
}
.locale-switch label {
  cursor: pointer;
  padding: 4px 14px;
  border-radius: 999px;
  color: var(--fg-mute);
  user-select: none;
  transition: color 120ms ease, background 120ms ease;
}
.locale-switch label:hover { color: var(--fg); }
#loc-ja:checked ~ .report .locale-switch label[for="loc-ja"],
#loc-en:checked ~ .report .locale-switch label[for="loc-en"] {
  background: var(--accent);
  color: white;
}
#loc-ja:checked ~ .report [lang="en"] { display: none; }
#loc-en:checked ~ .report [lang="ja"] { display: none; }
`;
