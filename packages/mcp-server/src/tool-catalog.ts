/**
 * Single source of truth for chainq MCP tool metadata.
 *
 * The descriptions here are the ones registered on the live MCP server,
 * imported by `server.ts`. The same array is re-exported from the package
 * root so other surfaces (the CLI's `chainq tools` command, docs site,
 * tests) can render the catalog without spinning up a server.
 *
 * If you add or rename a tool, do it here AND in the matching `server.tool`
 * call. They reference this map by name so the description stays in sync.
 */

export interface ToolDoc {
  /** Fully-qualified MCP tool name (always `chainq_*`). */
  name: string;
  /** Short human-readable label used in `chainq tools` listings. */
  title: string;
  /** Description shown to MCP clients and registered on the server. */
  description: string;
  /** Logical grouping for documentation rendering. */
  group: "discovery" | "execution" | "semantic" | "recall" | "render" | "report" | "budget";
}

export const TOOL_CATALOG: readonly ToolDoc[] = [
  {
    name: "chainq_list_tables",
    title: "List tables",
    group: "discovery",
    description:
      "List every curated table with name, supported chains, and a one-line summary. " +
      "Cheap: no query is executed. Use as the first call when exploring.",
  },
  {
    name: "chainq_search_tables",
    title: "Search tables",
    group: "discovery",
    description:
      "Search curated tables by free-text name / description, optionally filtered by chain. " +
      "Returns the same shape as `chainq_describe` for matching rows.",
  },
  {
    name: "chainq_describe",
    title: "Describe table",
    group: "discovery",
    description:
      "Return the full schema, sample rows, partition hints, dbt lineage, " +
      "copy-paste-ready sample queries, and gotchas for one table. " +
      "Returns a `ChainqError` with code `UNKNOWN_TABLE` when the name is unknown.",
  },
  {
    name: "chainq_estimate_cost",
    title: "Estimate cost",
    group: "execution",
    description:
      "Estimate rows, bytes, seconds, and credits for a SQL query without running it. " +
      "Always returns the current `budget` status and a `decision` field — " +
      "advisory, never blocks the agent. Use this before `chainq_query` to plan.",
  },
  {
    name: "chainq_query",
    title: "Run SQL",
    group: "execution",
    description:
      "Execute a SQL query with row and timeout caps. The result is cached for `chainq_recall`. " +
      "Pre-checks the per-session budget; returns `BUDGET_EXCEEDED` and DOES NOT run when " +
      "the estimate would breach a cap. On success, the response includes the updated `budget`.",
  },
  {
    name: "chainq_list_metrics",
    title: "List metrics",
    group: "semantic",
    description:
      "Enumerate semantic-layer metrics: name, description, dimensions, filters, " +
      "and guardrails. Cheap.",
  },
  {
    name: "chainq_metric",
    title: "Run metric",
    group: "semantic",
    description:
      "Execute a named metric from the semantic layer with the requested dimensions / filters / " +
      "time-or-epoch window. Subject to the same budget pre-check as `chainq_query`. " +
      "Returns `{ metric, sql, result, budget }` on success.",
  },
  {
    name: "chainq_recall",
    title: "Recall (search)",
    group: "recall",
    description:
      "Search past query and metric runs cached for this session. BM25-ranked over " +
      "the SQL text plus user-supplied label. Falls back to recency when the query " +
      "matches no tokens. Useful for `did I already compute this?` checks.",
  },
  {
    name: "chainq_recall_by_id",
    title: "Recall (load)",
    group: "recall",
    description:
      "Return the full cache entry by id, including a preview of the saved result rows. " +
      "Returns `RECALL_FAILED` when the id is unknown.",
  },
  {
    name: "chainq_chart_render",
    title: "Render chart",
    group: "render",
    description:
      "Render a vega-lite chart from a result-set and save it. Supports three formats: " +
      "`svg` (static), `html` (single-file interactive page loading vega from CDN), " +
      "and `vegalite-json` (raw spec for downstream rendering). " +
      "If `format` is omitted, it is inferred from the filename extension and defaults to `svg`.",
  },
  {
    name: "chainq_report",
    title: "Write report",
    group: "report",
    description:
      "Write a Markdown report file. Supports YAML frontmatter, tables (from row arrays), " +
      "and chart embeds (relative path + caption). Obsidian-compatible.",
  },
  {
    name: "chainq_budget_set",
    title: "Set budget caps",
    group: "budget",
    description:
      "Set per-session budget caps on credits / rows / bytes / seconds. " +
      "Pass `{}` to clear caps without resetting consumption. " +
      "Once set, `chainq_query` and `chainq_metric` reject calls whose estimate would breach a cap.",
  },
  {
    name: "chainq_budget_status",
    title: "Budget status",
    group: "budget",
    description:
      "Return the active budget caps, running totals consumed this session, and remaining headroom.",
  },
  {
    name: "chainq_budget_clear",
    title: "Clear budget",
    group: "budget",
    description:
      "Clear all budget caps AND reset the consumption counters to zero. " +
      "Use between independent agent tasks to start with a clean slate.",
  },
] as const;

const BY_NAME: Record<string, ToolDoc> = Object.fromEntries(
  TOOL_CATALOG.map((t) => [t.name, t]),
);

/** Lookup a tool's description by name. Throws if the name is not in the catalog. */
export function describe(name: string): string {
  const t = BY_NAME[name];
  if (!t) throw new Error(`tool-catalog: no entry for '${name}'`);
  return t.description;
}
