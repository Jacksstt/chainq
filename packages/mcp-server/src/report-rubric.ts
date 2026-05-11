/**
 * Report writing rubric + scorer.
 *
 * The fix for "the agent writes mechanical, low-insight reports" is to make
 * the writing pattern a first-class object, not a free-form prose call.
 * This module:
 *
 *   1. Defines what a good chainq report contains (the rubric).
 *   2. Scores a `ReportSpec` against that rubric before it's written,
 *      so every report ships with a quality score the author can inspect.
 *   3. Exposes structured "writing primitives" — `executiveBullet`,
 *      `anomalyCallout`, `comparison`, `actionItem` — that emit the
 *      bilingual prose patterns the rubric is looking for.
 *
 * Together: writers (human or agent) can't easily produce mechanical
 * filler, because the helpers force the load-bearing components
 * (headline / evidence / implication) into the output. And if they
 * route around the helpers, the rubric scorer surfaces the drop in
 * insight density immediately.
 */

import type { I18nString, Localizable, ReportSection, ReportSpec } from "./report.js";

// ---------------------------------------------------------------- rubric

export interface RubricCriterion {
  id: string;
  description: string;
  /** 0..1 — fraction of the criterion satisfied. */
  score: number;
  /** Concrete evidence (or absence thereof). */
  evidence: string;
}

export interface RubricScore {
  /** Overall 0..100 score, equally weighted across criteria. */
  total: number;
  criteria: RubricCriterion[];
  /** Human-readable summary of the top failures, ordered worst-first. */
  failures: string[];
  /** Specific suggestions to improve the score. */
  suggestions: string[];
}

/**
 * Score a ReportSpec against the chainq writing rubric.
 *
 * The criteria capture what makes a report useful vs. mechanical:
 *   - Lead with insight, not methodology
 *   - Quantify comparisons (numbers + units)
 *   - Flag anomalies explicitly
 *   - End with action items / implications
 *   - Specific, evidence-anchored caveats
 *   - High insight density (quantified claims per section)
 *
 * Returns a score 0..100 + per-criterion breakdown + concrete suggestions.
 * Scoring is intentionally conservative: a 70+ is "shippable", 85+ is
 * "publishable", 95+ is "indistinguishable from a human senior analyst".
 */
export function scoreReport(spec: ReportSpec): RubricScore {
  const criteria: RubricCriterion[] = [];

  const lang: "en" | "ja" = spec.locale === "ja" ? "ja" : "en";
  const allText = collectAllText(spec, lang);

  // --- 1. Lead with insight, not methodology -----------------------------
  const firstSectionHeading = pickLower(spec.sections[0]?.heading, lang);
  const startsWithMethodology = /^\s*(\d+\.\s*)?(methodology|method|approach|setup|data\s+scope|データ範囲|メソドロ|手法|スコープ|方法論)/i.test(firstSectionHeading);
  const summaryText = pickLower(spec.summary, lang);
  const summaryHasNumber = /\b\d/.test(summaryText) || /[０-９]/.test(summaryText);
  criteria.push({
    id: "lead_with_insight",
    description: "Open with a quantified finding, not the methodology.",
    score: !startsWithMethodology && summaryHasNumber ? 1.0 : startsWithMethodology ? 0 : summaryHasNumber ? 0.5 : 0,
    evidence: startsWithMethodology
      ? `First section is "${firstSectionHeading}" — methodology before findings.`
      : !summaryHasNumber
        ? "Summary contains no quantitative anchor."
        : "Summary contains numbers and the first section is a finding.",
  });

  // --- 2. Insight density: quantitative claims per section ---------------
  const numericClaims = (allText.match(/[-+]?\d[\d,]*\.?\d*\s*(%|×|x\b|億|万|TiB|GiB|MiB|MB|KB|seconds?|sec|ms|days?|blocks?|logs?|tx|chains?|providers?)/gi) ?? []).length;
  const sectionCount = Math.max(1, spec.sections.length);
  const density = numericClaims / sectionCount;
  criteria.push({
    id: "insight_density",
    description: "Quantitative claims per section ≥ 2.0 (numbers anchor every finding).",
    score: Math.min(1, density / 2.0),
    evidence: `${numericClaims} numeric claims across ${sectionCount} sections (density ${density.toFixed(2)} / section)`,
  });

  // --- 3. Has anomaly callouts -------------------------------------------
  const anomalyHits = (allText.match(/anomal|outlier|unusual|surprising|deviation|σ|sigma|stands?\s+out|stood\s+out|異常|外れ値|意外|想定外|乖離/gi) ?? []).length;
  criteria.push({
    id: "anomaly_callouts",
    description: "At least one explicit anomaly callout (something deviates from baseline).",
    score: anomalyHits >= 2 ? 1.0 : anomalyHits === 1 ? 0.6 : 0,
    evidence: `${anomalyHits} anomaly markers found`,
  });

  // --- 4. Comparisons ----------------------------------------------------
  const comparisonHits = (allText.match(/\b(\d[\d,.]*\s*(?:%|×|x\b|times))\s+(more|less|higher|lower|larger|smaller|fewer|greater|than|compared)/gi) ?? []).length
    + (allText.match(/[較比]?\s*\d[\d,.]*\s*(倍|％|%)\s*(高|低|多|少|大|小|超|未満)/g) ?? []).length;
  criteria.push({
    id: "explicit_comparisons",
    description: "At least 2 quantified comparisons (vs baseline, vs peer chain, vs prior period).",
    score: Math.min(1, comparisonHits / 2),
    evidence: `${comparisonHits} explicit comparison phrases`,
  });

  // --- 5. Action items / implications ------------------------------------
  const actionHits = (allText.match(/should|recommend|consider|implies?|implications?|if\s+you\b|next\s+step|next\s+action|アクション|示唆|含意|推奨|べき|考慮/gi) ?? []).length;
  criteria.push({
    id: "action_items",
    description: "Connects findings to actions or implications for specific personas.",
    score: actionHits >= 3 ? 1.0 : actionHits >= 1 ? 0.5 : 0,
    evidence: `${actionHits} action/implication markers`,
  });

  // --- 6. Caveats are specific, not generic ------------------------------
  const caveatSection = spec.sections.find((s) => {
    const h = pickLower(s.heading, lang);
    return /caveats?|notes?|gotchas?|limitations?|注意|留意|備考|免責/i.test(h);
  });
  let caveatScore = 0;
  let caveatEvidence = "no caveats section found";
  if (caveatSection) {
    const body = pickLower(caveatSection.body, lang);
    const specific = /\b\d/.test(body) || /[０-９]/.test(body);
    const length = body.length;
    caveatScore = specific && length > 120 ? 1.0 : specific ? 0.7 : length > 120 ? 0.4 : 0.2;
    caveatEvidence = `caveats section: ${length} chars, ${specific ? "with" : "without"} quantitative anchors`;
  }
  criteria.push({
    id: "specific_caveats",
    description: "Caveats reference real numbers / specific tables, not generic warnings.",
    score: caveatScore,
    evidence: caveatEvidence,
  });

  // --- 7. Filler word penalty --------------------------------------------
  const fillerHits = (allText.match(/\b(various|notable|interesting|things|stuff|several|some\s+of|a\s+lot|kind\s+of|sort\s+of|可能性が|興味深い|様々な|いくつかの|なんらかの)/gi) ?? []).length;
  const wordCount = allText.split(/\s+/).length;
  const fillerRate = fillerHits / Math.max(1, wordCount / 100); // per 100 words
  criteria.push({
    id: "filler_penalty",
    description: "Filler / hedge phrases per 100 words ≤ 1.0.",
    score: fillerRate <= 0.5 ? 1.0 : fillerRate <= 1.0 ? 0.7 : fillerRate <= 2.0 ? 0.4 : 0.1,
    evidence: `${fillerHits} filler phrases / ${wordCount} words = ${fillerRate.toFixed(2)} per 100 words`,
  });

  // --- 8. Has table or chart with downloads ------------------------------
  const sectionsWithDownloads = spec.sections.filter((s) => (s.downloads?.length ?? 0) > 0).length;
  const sectionsWithTable = spec.sections.filter((s) => (s.table?.length ?? 0) > 0).length;
  const sectionsWithChart = spec.sections.filter((s) => s.chartPath != null).length;
  criteria.push({
    id: "reproducibility",
    description: "Provides downloadable data (CSV / parquet) alongside the rendered figures.",
    score: sectionsWithDownloads >= 2 ? 1.0 : sectionsWithDownloads === 1 ? 0.5 : 0,
    evidence: `tables=${sectionsWithTable}, charts=${sectionsWithChart}, sections-with-downloads=${sectionsWithDownloads}`,
  });

  // --- aggregate ----------------------------------------------------------
  const total = (criteria.reduce((s, c) => s + c.score, 0) / criteria.length) * 100;
  const failures = criteria
    .filter((c) => c.score < 0.7)
    .sort((a, b) => a.score - b.score)
    .map((c) => `${c.id} (${(c.score * 100).toFixed(0)}/100): ${c.evidence}`);
  const suggestions = buildSuggestions(criteria);

  return { total: Math.round(total), criteria, failures, suggestions };
}

function buildSuggestions(criteria: RubricCriterion[]): string[] {
  const out: string[] = [];
  for (const c of criteria) {
    if (c.score >= 0.7) continue;
    switch (c.id) {
      case "lead_with_insight":
        out.push("Reorder sections so a quantified finding appears before any methodology section. The summary line should carry at least one concrete number.");
        break;
      case "insight_density":
        out.push("Add quantitative anchors to each section — every claim should reference a number (count, %, multiplier, or unit). Target ≥ 2 per section.");
        break;
      case "anomaly_callouts":
        out.push("Use `anomalyCallout()` from `report-rubric` to call out at least one observation that deviates from a baseline (\"X stands out because…\").");
        break;
      case "explicit_comparisons":
        out.push("Add at least 2 quantified comparisons (\"X is N× higher than Y\" / \"X is N% lower than the chain average\"). Use the `comparison()` helper.");
        break;
      case "action_items":
        out.push("Append an `actionItem({ persona, recommendation })` section that tells specific readers what to do with the finding.");
        break;
      case "specific_caveats":
        out.push("Caveats should cite the actual numbers in the report (\"the 28,529-log window is 100 seconds, so the rate is X/sec\"), not generic disclaimers.");
        break;
      case "filler_penalty":
        out.push("Remove hedge / filler phrases (various, notable, interesting, several, possibility). Replace with the specific finding.");
        break;
      case "reproducibility":
        out.push("Attach `downloads: [{ path, label, format }]` to every section that presents data, so readers can grab the underlying CSV / JSON / Parquet.");
        break;
    }
  }
  return out;
}

function collectAllText(spec: ReportSpec, lang: "en" | "ja"): string {
  const parts: string[] = [];
  parts.push(pick(spec.title, lang));
  parts.push(pick(spec.summary, lang));
  for (const s of spec.sections) {
    parts.push(pick(s.heading, lang));
    parts.push(pick(s.body, lang));
    parts.push(pick(s.caption, lang));
  }
  return parts.filter(Boolean).join("\n");
}

function pick(v: Localizable | undefined, lang: "en" | "ja"): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return v[lang] ?? v.en ?? v.ja ?? "";
}

function pickLower(v: Localizable | undefined, lang: "en" | "ja"): string {
  return pick(v, lang).toLowerCase();
}

// ---------------------------------------------------------------- writing primitives

/**
 * A 3-part executive-summary bullet: HEADLINE → EVIDENCE → IMPLICATION.
 * Forces the writer to land each bullet on a finding, prove it, then close
 * with a "so what." Returns a Markdown-formatted line you can drop into a
 * report `body`.
 *
 *   executiveBullet({
 *     headline: "Base has the densest activity per second of any L2 we measured",
 *     evidence: "28,529 logs in a 100-second window — 285/sec — vs Unichain's 1.4/sec",
 *     implication: "If you're choosing where to deploy a new dApp, Unichain is open territory.",
 *   })
 */
export interface ExecutiveBulletInput {
  headline: Localizable;
  evidence: Localizable;
  implication?: Localizable;
}

export function executiveBullet(b: ExecutiveBulletInput, lang: "en" | "ja"): string {
  const h = pick(b.headline, lang);
  const e = pick(b.evidence, lang);
  const i = pick(b.implication, lang);
  if (i) return `- **${h}** — ${e}. ${i}`;
  return `- **${h}** — ${e}.`;
}

/**
 * Anomaly callout: contrast an observed value against a baseline (mean,
 * peer, prior period) with an explicit deviation magnitude.
 *
 *   anomalyCallout({
 *     what: "Base log volume",
 *     observed: 28529,
 *     baseline: 8049,
 *     baselineLabel: "8-chain mean",
 *     unit: "logs",
 *   })
 */
export interface AnomalyCalloutInput {
  what: Localizable;
  observed: number;
  baseline: number;
  baselineLabel?: Localizable;
  unit?: string;
  /** Optional hypothesis for WHY it deviates. Improves the score on `action_items`. */
  hypothesis?: Localizable;
}

export function anomalyCallout(a: AnomalyCalloutInput, lang: "en" | "ja"): string {
  const what = pick(a.what, lang);
  const baselineLabel = pick(a.baselineLabel, lang) || (lang === "ja" ? "ベースライン" : "baseline");
  const unit = a.unit ? ` ${a.unit}` : "";
  const ratio = a.baseline === 0 ? Infinity : a.observed / a.baseline;
  const isHigher = a.observed > a.baseline;
  const magnitude = ratio === Infinity
    ? lang === "ja" ? "ベースライン 0 に対し非ゼロ" : "non-zero against zero baseline"
    : isHigher
      ? lang === "ja" ? `${ratio.toFixed(1)}倍高い` : `${ratio.toFixed(1)}× higher`
      : lang === "ja" ? `${(a.baseline / Math.max(1, a.observed)).toFixed(1)}倍低い` : `${(a.baseline / Math.max(1, a.observed)).toFixed(1)}× lower`;
  const hypothesis = pick(a.hypothesis, lang);
  if (lang === "ja") {
    return `**${what} は ${baselineLabel}（${a.baseline.toLocaleString()}${unit}）に対し ${a.observed.toLocaleString()}${unit} — ${magnitude}。**${hypothesis ? ` ${hypothesis}` : ""}`;
  }
  return `**${what} stands out at ${a.observed.toLocaleString()}${unit} against the ${baselineLabel} (${a.baseline.toLocaleString()}${unit}) — ${magnitude}.**${hypothesis ? ` ${hypothesis}` : ""}`;
}

/**
 * Quantified comparison between two named values. Use when you want
 * "X is N× Y" without invoking baseline language.
 */
export interface ComparisonInput {
  a: { label: Localizable; value: number };
  b: { label: Localizable; value: number };
  unit?: string;
}

export function comparison(c: ComparisonInput, lang: "en" | "ja"): string {
  const al = pick(c.a.label, lang);
  const bl = pick(c.b.label, lang);
  const unit = c.unit ? ` ${c.unit}` : "";
  const ratio = c.b.value === 0 ? Infinity : c.a.value / c.b.value;
  const isHigher = c.a.value > c.b.value;
  if (lang === "ja") {
    return `${al}（${c.a.value.toLocaleString()}${unit}）は ${bl}（${c.b.value.toLocaleString()}${unit}）の ${ratio === Infinity ? "∞" : ratio.toFixed(1)}倍${isHigher ? "" : "下"}。`;
  }
  return `${al} (${c.a.value.toLocaleString()}${unit}) is ${ratio === Infinity ? "infinitely" : ratio.toFixed(1) + "×"} ${isHigher ? "higher than" : "lower than"} ${bl} (${c.b.value.toLocaleString()}${unit}).`;
}

/**
 * Action item for a named persona.
 *   actionItem({ persona: "dApp deployer", recommendation: "consider Unichain — open territory" })
 */
export interface ActionItemInput {
  persona: Localizable;
  recommendation: Localizable;
  /** Optional urgency: "now" / "this quarter" / "watch". */
  urgency?: Localizable;
}

export function actionItem(a: ActionItemInput, lang: "en" | "ja"): string {
  const p = pick(a.persona, lang);
  const r = pick(a.recommendation, lang);
  const u = pick(a.urgency, lang);
  if (lang === "ja") {
    return `**${p} へ:** ${r}${u ? `（${u}）` : ""}`;
  }
  return `**If you are a ${p}:** ${r}${u ? ` (${u})` : ""}`;
}

/**
 * Render a full bilingual section using the three primitives. Useful for
 * the Executive Summary section where the writer is most prone to filler.
 */
export interface ExecutiveSummarySection {
  heading?: I18nString;
  bullets: ExecutiveBulletInput[];
}

export function executiveSummarySection(input: ExecutiveSummarySection): ReportSection {
  return {
    heading: input.heading ?? { en: "Executive summary", ja: "エグゼクティブサマリー" },
    body: {
      en: input.bullets.map((b) => executiveBullet(b, "en")).join("\n"),
      ja: input.bullets.map((b) => executiveBullet(b, "ja")).join("\n"),
    },
  };
}
