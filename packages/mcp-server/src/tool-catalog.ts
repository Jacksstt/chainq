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
  group: "discovery" | "execution" | "semantic" | "analytics" | "recall" | "render" | "report" | "budget" | "verify";
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
  // analytics block placed AFTER discovery / execution / semantic for catalog grouping.
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
    name: "chainq_concentration",
    title: "Concentration suite",
    group: "analytics",
    description:
      "Compute the full concentration suite (top-N shares, Herfindahl, Gini, Lorenz curve) " +
      "in one call. Pass an SQL SELECT that produces (group, value) pairs plus the name of the " +
      "value column. Returns `{ groups, total, topN, hhi, gini, lorenz }` — feed `lorenz` straight " +
      "into `chainq_chart_render` for a Lorenz visualisation.",
  },
  {
    name: "chainq_distribution",
    title: "Distribution summary",
    group: "analytics",
    description:
      "Compute count / min / P25 / median / P75 / P95 / P99 / max / mean over a numeric column. " +
      "Pass an SQL SELECT that produces the column.",
  },
  {
    name: "chainq_histogram",
    title: "Histogram",
    group: "analytics",
    description:
      "Build a fixed-width histogram from a numeric column. Buckets are aligned to multiples of " +
      "`bucket_size`. Returns `{ bucketSize, buckets: [{ from, to, count }] }` — feed straight " +
      "into `chainq_chart_render` for a bar chart.",
  },
  {
    name: "chainq_bucketize",
    title: "Tier buckets",
    group: "analytics",
    description:
      "Partition rows into custom-defined tiers and report count / sum / share per tier. Use this " +
      "for size-tier provider analyses, balance-band wallet bucketing, anything that needs labelled " +
      "ranges. Each bucket has `{ min, max, label }`; `min` is inclusive, `max` exclusive.",
  },
  {
    name: "chainq_anomalies",
    title: "Find anomalies",
    group: "analytics",
    description:
      "Detect outliers in a numeric column via z-score (default, threshold 2.0) or Tukey IQR fence. " +
      "Returns the distribution summary plus a list of anomalous rows sorted by |z| descending, with " +
      "baseline / stdev / direction. Feed the result straight into `anomalyCallout()` in your report " +
      "writer for a quantified \"X stands out because…\" callout.",
  },
  {
    name: "chainq_score_report",
    title: "Score report quality",
    group: "report",
    description:
      "Score a draft `ReportSpec` (title / summary / sections) against the chainq writing rubric. " +
      "Returns total 0..100 score, per-criterion breakdown, top failures, and concrete suggestions. " +
      "Criteria: lead-with-insight (not methodology), insight density ≥ 2 numeric claims/section, " +
      "anomaly callouts, quantified comparisons, action items, specific caveats, filler-phrase " +
      "penalty, reproducibility. Call BEFORE `chainq_report` to catch low-quality drafts.",
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
      "Render a polished vega-lite chart from a result-set and save it. Mark types: " +
      "`line` / `bar` / `area` / `point` / `stacked-bar` / `donut`. Formats: `svg` (static), " +
      "`html` (single-file interactive vega-embed page), `vegalite-json` (raw spec), `png` " +
      "(rasterized via @resvg/resvg-js, no native canvas dep). " +
      "Charts are styled with the chainq theme by default: 8-color categorical palette, " +
      "system + monospace fonts, subtle dotted gridlines, SI-prefix axis labels (28.5k / 1.6M), " +
      "rounded bar corners, tooltips, and `prefers-color-scheme`-aware palette via `theme: 'dark'`. " +
      "Optional `subtitle` for caption-style text under the title. Set `siFormat: false` to keep " +
      "raw numbers on axes.",
  },
  {
    name: "chainq_report",
    title: "Write report",
    group: "report",
    description:
      "Write a single-file report. Defaults to a polished HTML page (inline CSS, " +
      "system fonts, dark/light auto, print-friendly) with frontmatter, tables, " +
      "and chart embeds (`.svg` / `.png` inline, `.html` linked). Text fields (title, " +
      "summary, section heading / body / caption) accept either `string` or " +
      "`{ en, ja }`. Set `locale: \"en\"` / `\"ja\"` / `\"both\"` — `\"both\"` emits " +
      "a CSS-only language toggle (no JS). Pass `format: \"markdown\"` (or use a " +
      "`.md` filename) for Obsidian-compatible Markdown.",
  },
  {
    name: "chainq_verify",
    title: "Verify rows",
    group: "verify",
    description:
      "Trust-minimised verification of a result set against the canonical chain. " +
      "Pass an array of `rows` (each with a `block_number`) and an optional `chain` / `rpcUrls`. " +
      "Fetches the authoritative block hash for the boundary blocks from MULTIPLE independent " +
      "public RPC endpoints and accepts each only when a quorum agrees — reducing trust from " +
      "a single archive/RPC to a majority of providers. Returns a `VerificationReceipt` with " +
      "`verified`, per-block `agreements` (e.g. \"3/3\"), `unverifiedBlocks`, `blockHashes`, " +
      "and a deterministic SHA-256 `rowsHash`. NOTE: quorum is not a consensus proof — colluding " +
      "or shared-upstream providers can still fool it; a Helios-style consensus light client is the " +
      "deeper future level. Defaults to the keyless `PUBLIC_RPCS` list for the chain when `rpcUrls` " +
      "is omitted.",
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
