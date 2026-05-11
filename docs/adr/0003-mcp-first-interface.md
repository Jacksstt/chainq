# ADR-0003: MCP as the primary interface

**Status:** Accepted (2026-05-11)

## Context

`chainq` could expose its functionality through any of:

1. A web UI (Dune model)
2. A REST / GraphQL API
3. A CLI
4. A Model Context Protocol (MCP) server
5. Some mix

The primary user we are designing for is an AI agent — Claude Code, Codex, OpenClaw, custom LLM applications — not a human analyst clicking through dashboards.

## Decision

**MCP is the primary, canonical interface.** A CLI is provided as a thin wrapper for shell-script use and for environments where MCP is not yet supported. No web UI is built in v0.x.

## Rationale

- **The most expensive cost in analytics is context-switching, not query execution.** Agents already operate inside Claude Code, Codex, etc. Forcing them out to a separate web app or REST client is the analytics-tool equivalent of a UX antipattern.
- **MCP is the closest thing to a standard for agent-tool interfaces in 2026.** It's specified, multi-vendor (Anthropic, OpenAI-compatible shims, etc.), and has TypeScript / Python / Rust SDKs.
- **Schema discoverability comes for free.** MCP tools are self-describing through JSON Schema. An agent can `list_tools` and immediately know what's available without reading external docs.
- **Streaming is supported.** Long-running query results stream back via the MCP transport.
- The CLI is a 100-line wrapper that calls the same TypeScript functions the MCP server registers, so we maintain a single implementation.

## Alternatives considered

- **Web UI first.** Rejected: humans aren't the primary user; building a web app is months of work; Dune already exists for humans who want one.
- **REST API first.** Rejected: agents don't natively understand REST; we'd need to publish OpenAPI specs and rely on the agent to interpret them, which is brittle.
- **CLI first, MCP later.** Rejected: a CLI's output is unstructured text that agents have to parse heuristically. MCP gives us structured JSON-RPC by default.
- **gRPC.** Rejected: not yet first-class in the agent ecosystem, no equivalent of MCP's `list_tools` introspection.

## Consequences

- All new functionality must be exposed as an MCP tool first. The CLI inherits it automatically.
- Tool input schemas must be hand-written JSON Schema (we don't auto-generate from TypeScript yet).
- We commit to MCP version compatibility — breaking changes in the protocol must be tracked.
- A web UI is not a goal until v1+; users who want a UI can run Metabase / Superset against the same DuckDB / Parquet.

## Revisit when

- MCP is superseded by a clearly better agent-tool protocol (we adopt the new one).
- A specific consultancy engagement demands a web UI (we build it as a separate package on top of MCP).
