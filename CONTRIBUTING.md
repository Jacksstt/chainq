# Contributing to chainq

Thanks for your interest. The project is in **pre-alpha**, so the bar is "useful to one team" rather than "production-ready for many". Expect breakage. Read this before sending a PR.

## Before you start

1. **Open an issue first.** Describe what problem you're solving. We may already have a different plan, or want to scope it down.
2. **Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** to understand the design constraints.
3. **Check [`docs/adr/`](docs/adr/)** — if your change touches an architectural decision, propose a new ADR.

## Dev setup

```bash
git clone <repo>
cd chainq
pnpm install
pnpm typecheck
pnpm test
```

Node ≥ 20 and `pnpm` are required. The dbt subproject also needs `uv` (Python 3.11+).

## Coding standards

- TypeScript strict mode (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- Prefer composition over inheritance.
- Public functions need TSDoc; internal helpers do not.
- Tests for any new MCP tool.
- One concern per PR.

## Commit format

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(mcp-server): add estimate_cost tool
fix(ingest-evm): handle reorg at block boundary
docs: clarify Filecoin ingestion path
```

## Scope of contributions we welcome

- Bug fixes
- New curated tables in `spellbook/`
- New semantic metrics in `packages/core/semantic/`
- Additional chain ingest packages (Solana, Sui, etc.)
- MCP tool improvements
- Performance fixes with benchmarks

## Out of scope (for now)

- New query engines (we pick one and stay there until v0.5)
- Hosted SaaS features (billing, multi-tenant)
- Web UI

## License

By contributing you agree your contributions are MIT-licensed.
