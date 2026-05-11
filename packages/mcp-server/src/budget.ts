/**
 * Per-session cost governor for the MCP server.
 *
 * `BudgetTracker` keeps running totals for an agent session and can pre-check
 * a query estimate against caller-set caps. It is intentionally pure logic
 * (no DuckDB imports) so it can be unit-tested in isolation.
 *
 * Semantics:
 *   - `limits` are optional per axis. An absent key means "no cap on that
 *     axis" — the tracker neither blocks nor reports remaining headroom for
 *     it.
 *   - `consumed` is monotonically increasing for the life of the tracker
 *     until `clearConsumption()` is called.
 *   - `checkEstimate` is conservative: it adds the full estimate on top of
 *     current consumption and rejects if any capped axis would exceed.
 *   - `record(actual)` derives credits the same way `Engine.estimate` does
 *     (`max(1, ceil(rows / 1000))`) unless the caller passes an explicit
 *     `credits` value.
 */

export interface BudgetLimits {
  credits?: number;
  rows?: number;
  bytes?: number;
  seconds?: number;
}

export interface BudgetConsumption {
  credits: number;
  rows: number;
  bytes: number;
  seconds: number;
}

export interface BudgetStatus {
  limits: BudgetLimits;
  consumed: BudgetConsumption;
  remaining: Partial<BudgetConsumption>;
  active: boolean;
}

export interface BudgetDecision {
  allowed: boolean;
  reason?: string;
  wouldExceed?: Partial<
    Record<keyof BudgetLimits, { limit: number; consumed: number; estimate: number }>
  >;
}

export interface BudgetEstimateInput {
  estimatedRows: number;
  estimatedBytes: number;
  estimatedSeconds: number;
  estimatedCredits: number;
}

export interface BudgetActualInput {
  rows: number;
  bytes: number;
  seconds: number;
  credits?: number;
}

const AXES: ReadonlyArray<keyof BudgetLimits> = ["credits", "rows", "bytes", "seconds"];

export class BudgetTracker {
  private limits: BudgetLimits = {};
  private consumed: BudgetConsumption = { credits: 0, rows: 0, bytes: 0, seconds: 0 };

  /**
   * Replace the active limits. Pass `{}` to clear all caps.
   * Does NOT reset the running consumption — use `clearConsumption()` for
   * that, or call `chainq_budget_clear` which does both.
   */
  setLimits(limits: BudgetLimits): void {
    const next: BudgetLimits = {};
    for (const axis of AXES) {
      const v = limits[axis];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        next[axis] = v;
      }
    }
    this.limits = next;
  }

  clearConsumption(): void {
    this.consumed = { credits: 0, rows: 0, bytes: 0, seconds: 0 };
  }

  status(): BudgetStatus {
    const remaining: Partial<BudgetConsumption> = {};
    for (const axis of AXES) {
      const cap = this.limits[axis];
      if (typeof cap === "number") {
        remaining[axis] = Math.max(0, cap - this.consumed[axis]);
      }
    }
    return {
      limits: { ...this.limits },
      consumed: { ...this.consumed },
      remaining,
      active: AXES.some((axis) => typeof this.limits[axis] === "number"),
    };
  }

  checkEstimate(est: BudgetEstimateInput): BudgetDecision {
    const estimates: Record<keyof BudgetLimits, number> = {
      credits: est.estimatedCredits,
      rows: est.estimatedRows,
      bytes: est.estimatedBytes,
      seconds: est.estimatedSeconds,
    };
    const wouldExceed: NonNullable<BudgetDecision["wouldExceed"]> = {};
    for (const axis of AXES) {
      const cap = this.limits[axis];
      if (typeof cap !== "number") continue;
      const consumed = this.consumed[axis];
      const estimate = estimates[axis];
      if (consumed + estimate > cap) {
        wouldExceed[axis] = { limit: cap, consumed, estimate };
      }
    }
    if (Object.keys(wouldExceed).length === 0) {
      return { allowed: true };
    }
    const parts = Object.entries(wouldExceed).map(
      ([axis, info]) =>
        `${axis} (${info.consumed} + estimate ${info.estimate} > cap ${info.limit})`,
    );
    return {
      allowed: false,
      reason: `would exceed budget on: ${parts.join(", ")}`,
      wouldExceed,
    };
  }

  record(actual: BudgetActualInput): void {
    this.consumed.rows += Math.max(0, actual.rows);
    this.consumed.bytes += Math.max(0, actual.bytes);
    this.consumed.seconds += Math.max(0, actual.seconds);
    const credits =
      typeof actual.credits === "number"
        ? Math.max(0, actual.credits)
        : Math.max(1, Math.ceil(Math.max(0, actual.rows) / 1000));
    this.consumed.credits += credits;
  }
}
