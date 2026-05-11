# @chainq/playground

A browser-only chainq experience. DuckDB-WASM runs in the page; users paste a
Parquet URL and write SQL. No install, no backend, no RPC subscription.

## Local dev

```bash
pnpm install
pnpm --filter @chainq/playground dev
# → http://localhost:5173
```

Production build:

```bash
pnpm --filter @chainq/playground build
# → dist/ ready for any static host (GitHub Pages, Cloudflare Pages, S3+CF, Netlify…)
```

## How it works

1. The browser fetches a Parquet file from any URL the user pastes.
2. DuckDB-WASM (loaded from jsDelivr) materialises a virtual filesystem and
   registers the buffer as `dataset.parquet`.
3. A view `dataset` is created. The user's SQL runs against it directly in
   the browser — never sent to a server.

Because everything is client-side, there is no Auth, no quota, and no
data-residency footprint outside the user's machine. Same SQL surface as
the desktop chainq, no install.

## Status

Pre-alpha. Charting + multi-table workspace land in v0.1.
