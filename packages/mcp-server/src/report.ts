/**
 * Markdown report writer.
 *
 * Produces an Obsidian-friendly markdown file with optional YAML frontmatter
 * and inline tables / chart references.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ReportSection {
  heading: string;
  body?: string;
  table?: Record<string, unknown>[];
  chartPath?: string;
  caption?: string;
}

export interface ReportSpec {
  title: string;
  outPath: string;
  frontmatter?: Record<string, unknown>;
  summary?: string;
  sections: ReportSection[];
}

export function writeReport(spec: ReportSpec): string {
  const abs = resolve(spec.outPath);
  mkdirSync(dirname(abs), { recursive: true });
  const md = renderMarkdown(spec);
  writeFileSync(abs, md, "utf8");
  return abs;
}

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
      out.push(renderTable(section.table), "");
    }
    if (section.chartPath) {
      const caption = section.caption ?? section.heading;
      out.push(`![${caption}](${section.chartPath})`, "");
    }
  }

  return out.join("\n");
}

function renderTable(rows: Record<string, unknown>[]): string {
  const first = rows[0];
  if (!first) return "";
  const keys = Object.keys(first);
  const head = `| ${keys.join(" | ")} |`;
  const sep = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${keys.map((k) => formatCell(row[k])).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

function formatCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.replace(/\|/g, "\\|");
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

function formatFrontmatterValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  return JSON.stringify(value);
}
