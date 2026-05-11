/**
 * @chainq/core — shared types and schemas.
 *
 * Pre-alpha. Types will break before v0.1.0.
 */

export type ChainId =
  | "ethereum"
  | "base"
  | "polygon"
  | "arbitrum"
  | "optimism"
  | "solana"
  | "filecoin";

export interface TableDescriptor {
  /** Fully qualified name, e.g. `dex.trades`. */
  name: string;
  /** Human + LLM-readable summary. */
  description: string;
  /** Which chains the rows can come from. */
  chains: ChainId[];
  /** Column metadata. */
  columns: ColumnDescriptor[];
  /** Optional sample rows for agent introspection. */
  sample?: Record<string, unknown>[];
  /** Common pitfalls or gotchas an agent should know. */
  gotchas?: string[];
  /** Where the data comes from and how it was assembled. */
  lineage?: LineageEntry[];
  /** Ready-to-run example queries an agent can copy-paste. */
  sampleQueries?: SampleQuery[];
  /** Column names the table is partitioned by, when known. */
  partitions?: string[];
}

export interface LineageEntry {
  /** Where this column / table comes from, in plain English. */
  source: string;
  /** Optional transformation summary. */
  transform?: string;
  /** dbt model id this maps to (e.g. `dex.trades` → `models/dex/trades.sql`). */
  dbtModel?: string;
}

export interface SampleQuery {
  title: string;
  sql: string;
  /** Optional hint about typical result size, in rows. */
  expectedRows?: number;
}

export interface ColumnDescriptor {
  name: string;
  type: string;
  description: string;
  nullable: boolean;
}

export interface MetricDescriptor {
  metric: string;
  description: string;
  dimensions: string[];
  filters: string[];
  /** Estimated cost units before execution. */
  estimatedCost?: number;
  /** Guardrails that the engine will enforce. */
  guardrails?: MetricGuardrails;
}

export interface MetricGuardrails {
  maxRangeDays?: number;
  maxRows?: number;
  timeoutSeconds?: number;
}

export interface QueryEstimate {
  estimatedRows: number;
  estimatedBytes: number;
  estimatedSeconds: number;
  estimatedCredits: number;
  warnings: string[];
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  columnTypes: Record<string, string>;
  actualRows: number;
  actualBytes: number;
  actualSeconds: number;
  truncated: boolean;
}

export type CostBudget =
  | { type: "credits"; max: number }
  | { type: "rows"; max: number }
  | { type: "seconds"; max: number };

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Structured error codes surfaced through the MCP server so clients can
 * branch on failure reasons without parsing free-form English messages.
 */
export type ChainqErrorCode =
  | "BUDGET_EXCEEDED"
  | "UNKNOWN_TABLE"
  | "UNKNOWN_METRIC"
  | "QUERY_TIMEOUT"
  | "QUERY_FAILED"
  | "ESTIMATE_FAILED"
  | "INVALID_INPUT"
  | "RECALL_FAILED"
  | "CHART_FAILED"
  | "REPORT_FAILED"
  | "UNKNOWN";

export interface ChainqErrorShape {
  code: ChainqErrorCode;
  message: string;
  /** Optional structured details — budget breach, missing field, etc. */
  details?: Record<string, unknown>;
}

export class ChainqError extends Error implements ChainqErrorShape {
  readonly code: ChainqErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: ChainqErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "ChainqError";
  }
  toJSON(): ChainqErrorShape {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
