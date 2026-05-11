# ADR-0001: Monorepo with pnpm workspaces

**Status:** Accepted (2026-05-11)

## Context

`chainq` will consist of several deployables (MCP server, CLI, multiple ingesters) that share types, semantic-layer definitions, and integration tests. We must decide between a polyrepo and a monorepo, and which package manager to use.

## Decision

Use a **pnpm-workspaces monorepo** under `packages/*`.

```
chainq/
├── packages/
│   ├── core/             # shared types
│   ├── mcp-server/
│   ├── cli/
│   ├── ingest-evm/
│   └── ingest-filecoin/
└── spellbook/            # dbt project (not a pnpm package)
```

## Rationale

- Shared TypeScript types between MCP server and ingesters; cross-repo dependency hell is avoided.
- `pnpm` is the de-facto standard for new TypeScript monorepos in 2026, has the strongest dependency-isolation guarantees, and is the fastest of the three big options on the projects we have measured.
- We considered Nx and Turborepo for orchestration; both are reasonable, but for a five-package repo the overhead is not yet justified. We can adopt Turborepo later without re-organizing.
- A polyrepo would have forced us to publish private packages or use git submodules; both add friction without a clear win at this size.

## Consequences

- Contributors must install `pnpm` (`npm i -g pnpm`) rather than `npm`.
- CI must use `pnpm install --frozen-lockfile` and cache `~/.pnpm-store`.
- We commit to `pnpm-workspace.yaml` rather than `workspaces` in `package.json`.

## Revisit when

- The repo exceeds ~15 packages or build times exceed 60 seconds — at which point we re-evaluate Turborepo / Nx for caching.
- A package needs an independent release cadence severe enough to justify extraction.
