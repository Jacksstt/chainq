# Dune Free vs Dune Analyst vs chainq

A blunt comparison written to answer one question: **why would a builder or researcher pick
chainq over Dune's free or Analyst tier?**

> Dune is a great product. We respect it. This document is not anti-Dune — it's a clear-eyed
> statement of when chainq is the right tool and when it isn't.

## TL;DR

| If you are… | Use |
|---|---|
| A solo human writing five queries a week, sharing public dashboards | **Dune Free** |
| A solo human running daily medium-complexity workloads, needs API | **Dune Analyst ($75/mo)** |
| **An AI agent doing automated investigations, or a team that needs self-hosting / SQL freedom / no vendor lock-in** | **chainq** |

## Side-by-side

| Dimension | Dune Free | Dune Analyst ($75/mo) | chainq (self-hosted) |
|---|---|---|---|
| **Monthly cost** | $0 | $75 ($65/mo annual) | $0 license. ~$0–$50 infra. |
| **Credits / quota** | 2,500/mo. Overage **$5.00/100** | 4,000/mo. Overage $1.875/100 ($1.625 annual) | **No credits. No quota.** Bound only by your hardware. |
| **Datapoint efficiency** | 1 credit = 1,000 datapoints | 1 credit = 1,000 datapoints | n/a — full-table scans are free |
| **Engine** | Basic | Medium | DuckDB on Parquet (single-node, comparable to a Trino small cluster at <10 TB) |
| **Query SQL** | Yes, with quota | Yes, with quota | **Yes, unlimited.** It's your SQL on your data. |
| **API access** | Yes (still consumes credits) | Yes (still consumes credits) | **Native MCP + REST + CLI, no per-call billing** |
| **MCP / agent surface** | No | No | **First-class. The primary interface.** |
| **Cost estimation before run** | No (find out by burning credits) | No (find out by burning credits) | **`estimate_cost` returns rows/bytes/seconds before execution** |
| **Per-task budget caps** | Account-wide credit cap only | Account-wide credit cap only | **Per-query and per-agent-session hard caps** |
| **Curated tables (Spellbook)** | Yes (read-only) | Yes (read-only) | **Yes — same Spellbook, MIT-forked, fully writeable. Add private tables for your domain.** |
| **Private tables / org namespace** | No | No (Premium/Enterprise only) | **Yes, default. Your tables live on your disk.** |
| **Self-host** | No | No | **Yes — laptop, Mac mini, VPS, or air-gapped on-prem** |
| **Data residency / compliance** | Vendor's cloud | Vendor's cloud | **Your machine, your VPC, your jurisdiction** |
| **Chain coverage** | Wide; Dune-curated | Wide; Dune-curated | **Bring your own** (cryo / Subsquid / Filfox / Helius). No waiting for vendor to add a chain. |
| **Filecoin native (storage deals)** | Limited | Limited | **Built-in via `@chainq/ingest-filecoin`** |
| **Lock-in** | High (queries live in Dune) | High | **None.** Parquet files on disk; SQL works in any engine. |
| **Watermarks on public output** | Yes | Yes | **No** |
| **Latency** | Queued under load | Faster, still queued | Bound only by your machine's CPU and disk |
| **Team seats** | Limited | Unlimited (paid plan) | Whoever has SSH access |
| **Result caching** | Per-query, vendor-controlled | Per-query, vendor-controlled | **Result + vector recall: agents pull from past sessions** |
| **Reports / charts** | Web dashboards | Web dashboards | **Markdown + HTML written to your vault; PNG / SVG charts on disk** |
| **Source code** | Closed (Spellbook is open) | Closed | **MIT, all of it** |

## When chainq is the clear win

### 1. You're putting an AI agent in front of the data

Dune was designed for human web UI. Every agent task pays a tax: parse HTML, hit the API,
consume credits, retry on quota errors, repeat. With chainq the agent has:

- self-describing tool schemas (`list_tools`, `describe`)
- cost estimation **before** burning anything
- structured JSON errors instead of HTML pages
- a permanent local memory of past queries (no re-running)

A single Claude Code session can do work that would cost **dozens of dollars in Dune credits**
for $0 in infra.

### 2. You need full SQL freedom

Dune lets you write SQL, but the credit model penalizes exploration. A naive query against
`dex.trades` can chew through your monthly quota in a single afternoon. On chainq you scan
your Parquet files — the only cost is wall-clock time on your own machine.

### 3. You can't (or won't) put data in a vendor's cloud

Sensitive consulting engagements, regulated industries, internal accounting reconciliations,
trading-strategy R&D — anything where the query *itself* is intellectual property — cannot
go through Dune. chainq runs on a laptop or on-prem.

### 4. The chain you care about isn't a first-class citizen on Dune

Dune's chain coverage is wide but not infinite, and depths of coverage vary. With chainq
you point cryo / Subsquid / Helius / Filfox at the chain you care about and the curated
tables you write are yours. No waiting for vendor prioritization.

### 5. You want a build-once-keep-forever artifact

chainq's Parquet files and curated tables don't disappear if a vendor changes pricing or
shuts down. They're files on a disk you own.

## When Dune is the right tool (we mean it)

- You want a **share link to a public dashboard**. Dune is unbeaten.
- You want to **read other people's queries** and learn from the community.
- You want **zero setup**. Dune is "open URL, write SQL".
- You don't have someone willing to run a cron job.
- Your work is genuinely **occasional** — a few queries a week — and credits will never bind.

## The honest tradeoffs of chainq

We're pre-alpha. Specifically:

| You give up | Mitigation |
|---|---|
| Polished web UI | Use Metabase / Superset against the same DuckDB if you want one |
| "It just works in a browser" | You install pnpm + Node + cryo once |
| Vendor support | OSS community + issues |
| Vendor-curated chain coverage | You curate it yourself (with Spellbook as a head start) |
| Multi-user permissions out of the box | Single-user / SSH-trust assumed in v0.x |

If those tradeoffs are unacceptable for your use case, stay on Dune. Genuinely.

## Cost math: a concrete example

A consulting team investigates 5 onchain projects per month. Each investigation involves:

- ~20 ad-hoc SQL queries
- ~10 metric runs
- ~5 chart renders
- ~1 saved report

**On Dune Analyst ($75/mo):**
A non-trivial DEX-volume query against `dex.trades` over 90 days easily costs 50–200 credits.
20 queries × ~100 credits = 2,000 credits per investigation. 5 investigations = 10,000
credits — well over the 4,000-credit allowance. Overage: 6,000 × $0.01625 = **$97.50 in overage** + $75 base = **~$172.50/month**, and that's with discipline.

**On chainq (self-hosted):**
Same workload. Marginal cost: electricity + maybe $49/month if you upgrade your RPC plan.
**Total ~$0–$50/month.** Time savings comparable because the agent does most of the typing.

That's a 3–10x cost win **and** a workflow that an agent can run end-to-end without human
quota babysitting.

## Bottom line

If a human writes occasional SQL and shares pretty dashboards, pay Dune. If an agent does
the work, the data is sensitive, the chain is exotic, or the workload is heavy — you want
chainq.
