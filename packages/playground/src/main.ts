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
  schema: document.getElementById("schema") as HTMLDivElement,
  result: document.getElementById("result") as HTMLDivElement,
  samples: document.getElementById("samples") as HTMLDivElement,
};

const SQL_STORAGE_KEY = "chainq-playground:last-sql";

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let loaded = false;

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
  if (!url) {
    setStatus("Enter a Parquet URL first.", true);
    return;
  }
  els.load.disabled = true;
  els.load.textContent = "Loading…";
  try {
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
    const schema = await conn.query("DESCRIBE dataset");
    renderSchema(schema.toArray());
    setStatus(`Loaded ${formatNumber(Number(n))} rows from dataset.`);
    els.run.disabled = false;
    els.samples.hidden = false;
    loaded = true;
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    els.load.disabled = false;
    els.load.textContent = "Load";
  }
}

async function runQuery() {
  if (!loaded || !conn) {
    setStatus("Load a Parquet first.", true);
    return;
  }
  const sql = els.sql.value.trim();
  if (!sql) return;
  els.run.disabled = true;
  els.run.textContent = "Running…";
  try {
    setStatus("Running query…");
    const t0 = performance.now();
    const result = await conn.query(sql);
    const ms = (performance.now() - t0).toFixed(0);
    const rows = result.toArray();
    renderTable(rows);
    setStatus(`Returned ${rows.length} row${rows.length === 1 ? "" : "s"} in ${ms} ms.`);
    try {
      localStorage.setItem(SQL_STORAGE_KEY, sql);
    } catch {
      // localStorage may be disabled; non-fatal.
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
    els.result.innerHTML = "";
  } finally {
    els.run.disabled = false;
    els.run.textContent = "Run";
  }
}

function setStatus(text: string, error = false) {
  els.status.textContent = text;
  els.status.className = error ? "status error" : "status";
}

function renderSchema(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    els.schema.hidden = true;
    return;
  }
  // DESCRIBE returns column_name + column_type (plus other fields).
  const items = rows.map((r) => {
    const name = String(r["column_name"] ?? "");
    const type = String(r["column_type"] ?? "");
    return `<li><code>${escapeHtml(name)}</code> <span class="schema-type">${escapeHtml(type)}</span></li>`;
  }).join("");
  els.schema.innerHTML = `<details><summary>${rows.length} columns</summary><ul>${items}</ul></details>`;
  els.schema.hidden = false;
}

function renderTable(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    els.result.innerHTML = "<p class=\"empty\">No rows.</p>";
    return;
  }
  const cols = Object.keys(rows[0]!);
  const head = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = rows.slice(0, 200).map((row) => {
    return `<tr>${cols.map((c) => `<td>${escapeHtml(formatCell(row[c]))}</td>`).join("")}</tr>`;
  }).join("");
  const note = rows.length > 200 ? `<p class="note">(showing first 200 of ${formatNumber(rows.length)})</p>` : "";
  els.result.innerHTML =
    `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>${note}`;
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

function setSql(sql: string) {
  els.sql.value = sql;
  els.sql.focus();
}

els.load.addEventListener("click", () => {
  loadParquet(els.url.value.trim()).catch((err) => setStatus(err.message, true));
});

els.run.addEventListener("click", () => {
  runQuery().catch((err) => setStatus(err.message, true));
});

// Cmd/Ctrl + Enter from within the SQL textarea runs the query.
els.sql.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
    ev.preventDefault();
    runQuery().catch((err) => setStatus(err.message, true));
  }
});

// Sample query buttons populate the editor.
els.samples.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  if (t.tagName !== "BUTTON") return;
  const action = t.getAttribute("data-action");
  if (action === "head") setSql("SELECT * FROM dataset LIMIT 10");
  else if (action === "count") setSql("SELECT COUNT(*) AS rows FROM dataset");
  else if (action === "schema") setSql("DESCRIBE dataset");
});

// Restore the last query, if any.
try {
  const last = localStorage.getItem(SQL_STORAGE_KEY);
  if (last) els.sql.value = last;
} catch {
  // localStorage may be disabled; non-fatal.
}
