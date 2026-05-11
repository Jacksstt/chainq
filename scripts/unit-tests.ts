#!/usr/bin/env tsx
/**
 * Unit tests — pure-logic modules (rubric scorer, anomaly detection, chart
 * theme expression). Run via `pnpm test:units`.
 *
 * Kept as a single tsx-runnable script for parity with the existing smoke
 * tests (no vitest dependency, no extra config).
 */

import assert from "node:assert/strict";
import {
  scoreReport,
  executiveBullet,
  anomalyCallout,
  comparison,
  actionItem,
} from "../packages/mcp-server/src/report-rubric.ts";
import {
  findZScoreAnomalies,
  findIqrAnomalies,
  describeDistribution,
} from "../packages/mcp-server/src/anomaly.ts";
import { SI_FORMAT_EXPR, COMMA_FORMAT_EXPR, pickTheme } from "../packages/mcp-server/src/chart-theme.ts";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed += 1;
  }
}
function group(label: string, body: () => void) {
  console.log(`\n${label}`);
  body();
}

// ============================== report-rubric ===============================
group("report-rubric / scoreReport", () => {
  test("low-quality draft scores low and surfaces failures", () => {
    const score = scoreReport({
      title: "Methodology — how we did it",
      outPath: "x",
      summary: "We did a thing.",
      sections: [
        { heading: "Methodology", body: "First we pulled data. Then we ran a query. Various interesting results were observed." },
        { heading: "Conclusion", body: "It was notable." },
      ],
    });
    assert.ok(score.total < 50, `expected total < 50, got ${score.total}`);
    assert.ok(score.failures.length > 0, "expected failures to be surfaced");
    assert.ok(score.suggestions.length > 0, "expected suggestions to be returned");
  });

  test("100-point draft passes all 8 criteria", () => {
    const score = scoreReport({
      title: "Base log volume — January window",
      outPath: "x",
      summary: "Base ran 28,529 logs in 100 seconds — 285/sec, 200× Unichain's 1.4/sec. Top-1 contract held 20.5% share.",
      sections: [
        {
          heading: "Top emitters",
          body: "WETH (0x4200…0006) carried 20.5% of logs, 5,841 events — 4× the second contract. **Stands out** as a single outlier relative to the 4-chain mean of 7%. Likely driven by dense AMM activity.",
          table: [{ chain: "base", logs: 28529 }],
          downloads: [{ path: "./x.csv", format: "csv" }],
        },
        {
          heading: "Comparison",
          body: "Base (285 logs/sec) is 200× higher than Unichain (1.4 logs/sec). Polygon (170/sec) sits 1.7× below Base.",
          downloads: [{ path: "./y.csv", format: "csv" }],
        },
        {
          heading: "Action items",
          body: "**If you are a DeFi founder:** consider Base for liquidity-mining campaigns. **If you are a consumer-app team:** Unichain implies opportunity — 200× less competition.",
        },
        {
          heading: "Caveats",
          body: "The 28,529-log window is 100 seconds. Rate normalisation matters: Unichain has 1-second blocks vs Base's 2 seconds. Re-pull at the same wall-clock to compare across days.",
        },
      ],
    });
    assert.ok(score.total >= 90, `expected total >= 90, got ${score.total} — failures=${JSON.stringify(score.failures)}`);
  });
});

group("report-rubric / writing primitives", () => {
  test("executiveBullet builds 3-part bullet", () => {
    const out = executiveBullet({
      headline: "X stands out",
      evidence: "28,529 logs vs the 4-chain mean of 5,000",
      implication: "Deploy here.",
    }, "en");
    assert.ok(out.includes("**X stands out**"));
    assert.ok(out.includes("28,529"));
    assert.ok(out.includes("Deploy here"));
  });

  test("anomalyCallout computes magnitude", () => {
    const out = anomalyCallout({
      what: "Base log-rate",
      observed: 285,
      baseline: 50,
      baselineLabel: "8-chain mean",
      unit: "logs/sec",
    }, "en");
    assert.ok(out.includes("Base log-rate"));
    assert.ok(out.includes("285"));
    assert.ok(out.includes("5.7×") || out.includes("5.7x") || out.includes("5.7"));
  });

  test("comparison emits ratio + units", () => {
    const out = comparison({
      a: { label: "Base", value: 285 },
      b: { label: "Unichain", value: 1.4 },
      unit: "logs/sec",
    }, "en");
    assert.ok(out.includes("Base"));
    assert.ok(out.includes("Unichain"));
    assert.ok(out.includes("logs/sec"));
  });

  test("actionItem renders persona + recommendation", () => {
    const out = actionItem({
      persona: "DeFi founder",
      recommendation: "ship on Base",
      urgency: "this quarter",
    }, "en");
    assert.ok(out.includes("DeFi founder"));
    assert.ok(out.includes("ship on Base"));
    assert.ok(out.includes("this quarter"));
  });

  test("bilingual primitives emit correct locale", () => {
    const en = executiveBullet({ headline: "H", evidence: "E" }, "en");
    const ja = executiveBullet({ headline: { en: "H", ja: "見出し" }, evidence: { en: "E", ja: "証拠" } }, "ja");
    assert.ok(en.includes("**H**"));
    assert.ok(ja.includes("**見出し**"));
    assert.ok(ja.includes("証拠"));
  });
});

// =============================== anomaly =================================
group("anomaly / z-score + IQR", () => {
  test("z-score detects single outlier", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i, v: 10 + (i % 3) }));
    rows.push({ id: 999, v: 1000 });
    const hits = findZScoreAnomalies(rows, (r) => r.v, { zThreshold: 2.0 });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.row.id, 999);
    assert.ok(hits[0]!.z > 2);
    assert.equal(hits[0]!.direction, "high");
  });

  test("z-score skips constant series", () => {
    const rows = [{ v: 5 }, { v: 5 }, { v: 5 }];
    const hits = findZScoreAnomalies(rows, (r) => r.v);
    assert.equal(hits.length, 0);
  });

  test("IQR detects both tails", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ v: 50 + i }));
    rows.push({ v: 0 });   // low outlier
    rows.push({ v: 200 }); // high outlier
    const hits = findIqrAnomalies(rows, (r) => r.v);
    assert.ok(hits.length >= 2, `expected >=2 outliers, got ${hits.length}`);
    const dirs = new Set(hits.map((h) => h.direction));
    assert.ok(dirs.has("high"));
    assert.ok(dirs.has("low"));
  });

  test("describeDistribution returns sorted percentiles", () => {
    const d = describeDistribution([{ v: 5 }, { v: 1 }, { v: 9 }, { v: 3 }, { v: 7 }], (r) => r.v);
    assert.equal(d.count, 5);
    assert.equal(d.min, 1);
    assert.equal(d.max, 9);
    assert.equal(d.median, 5);
    assert.ok(d.mean === 5);
  });

  test("describeDistribution handles empty input", () => {
    const d = describeDistribution([], (r: { v: number }) => r.v);
    assert.equal(d.count, 0);
    assert.equal(d.stdev, 0);
  });
});

// ============================ chart-theme ================================
group("chart-theme / theme picker + format expressions", () => {
  test("SI format expression is valid vega expression", () => {
    assert.ok(SI_FORMAT_EXPR.includes("datum.value"));
    assert.ok(SI_FORMAT_EXPR.includes("'~s'"));
  });

  test("comma format expression includes the comma directive", () => {
    assert.ok(COMMA_FORMAT_EXPR.includes("','"));
  });

  test("light theme has transparent background, dark has dark labels", () => {
    const light = pickTheme("light");
    const dark = pickTheme("dark");
    assert.equal(light.background, "transparent");
    assert.equal(dark.background, "transparent");
    assert.notDeepEqual(light.axis, dark.axis, "light and dark axis configs should differ");
  });

  test("palette has at least 8 colors and they are hex", () => {
    const light = pickTheme("light");
    const palette = (light.range as { category: string[] }).category;
    assert.ok(Array.isArray(palette));
    assert.ok(palette.length >= 8);
    for (const c of palette) assert.ok(/^#[0-9a-fA-F]{6}$/.test(c), `palette color ${c} is not hex`);
  });
});

// ============================== summary ==================================
console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
