/**
 * chainq playground — DuckDB-WASM in the browser.
 *
 * No server, no install. Paste a Parquet URL, write SQL, get rows.
 */

import * as duckdb from "@duckdb/duckdb-wasm";

const els = {
  url: document.getElementById("parquet-url") as HTMLInputElement,
  load: document.getElementById("load-btn") as HTMLButtonElement,
  sql: document.getElementById("sql") as HTMLTextAreaElement,
  run: document.getElementById("run-btn") as HTMLButtonElement,
  status: document.getElementById("status") as HTMLDivElement,
  result: document.getElementById("result") as HTMLDivElement,
};

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;

async function bootDuckDB(): Promise<duckdb.AsyncDuckDB> {
  setStatus("Booting DuckDB-WASM…");
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const workerBlob = new Blob(
    [`importScripts("${bundle.mainWorker}");`],
    { type: "text/javascript" },
  );
  const worker = new Worker(URL.createObjectURL(workerBlob));
  const logger = new duckdb.ConsoleLogger();
  const next = new duckdb.AsyncDuckDB(logger, worker);
  await next.instantiate(bundle.mainModule);
  return next;
}

async function loadParquet(url: string) {
  if (!db) db = await bootDuckDB();
  if (!conn) conn = await db.connect();
  setStatus(`Fetching ${url} …`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  // Stage the Parquet in DuckDB's virtual FS, then register a view.
  await db.registerFileBuffer("dataset.parquet", buf);
  await conn.query(`DROP VIEW IF EXISTS dataset`);
  await conn.query(`CREATE VIEW dataset AS SELECT * FROM 'dataset.parquet'`);
  const count = await conn.query("SELECT COUNT(*) AS n FROM dataset");
  const n = count.toArray()[0]?.n ?? 0n;
  setStatus(`Loaded ${formatNumber(Number(n))} rows from dataset.`);
  els.run.disabled = false;
}

async function runQuery() {
  if (!conn) throw new Error("Load a Parquet first.");
  const sql = els.sql.value.trim();
  if (!sql) return;
  setStatus("Running query…");
  const t0 = performance.now();
  const result = await conn.query(sql);
  const ms = (performance.now() - t0).toFixed(0);
  const rows = result.toArray();
  renderTable(rows);
  setStatus(`Returned ${rows.length} rows in ${ms} ms.`);
}

function setStatus(text: string, error = false) {
  els.status.textContent = text;
  els.status.className = error ? "status error" : "status";
}

function renderTable(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    els.result.innerHTML = "<p>No rows.</p>";
    return;
  }
  const cols = Object.keys(rows[0]!);
  const head = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = rows.slice(0, 200).map((row) => {
    return `<tr>${cols.map((c) => `<td>${escapeHtml(formatCell(row[c]))}</td>`).join("")}</tr>`;
  }).join("");
  const note = rows.length > 200 ? `<p>(showing first 200 of ${rows.length})</p>` : "";
  els.result.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>${note}`;
}

function formatCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

els.load.addEventListener("click", () => {
  loadParquet(els.url.value.trim()).catch((err) => setStatus(err.message, true));
});

els.run.addEventListener("click", () => {
  runQuery().catch((err) => setStatus(err.message, true));
});
