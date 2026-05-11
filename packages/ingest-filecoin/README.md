# @chainq/ingest-filecoin

Filecoin-native ingestion. Wraps Filfox, Glif (Lotus RPC), and Spacescan.

## Why a dedicated package?

Filecoin has two distinct layers:

- **Native:** storage deals, miners, sectors, DataCap — only reachable through Filecoin-specific APIs.
- **FVM:** EVM-compatible smart contracts — reachable via `@chainq/ingest-evm` with an FVM RPC.

This package handles the native side. FVM contracts go through the EVM package.

## Sources

- [Filfox API](https://filfox.info/api) — explorer-grade REST API
- [Glif Nodes](https://api.node.glif.io/) — Lotus RPC
- [Spacescan](https://spacescan.io/) — deal and miner analytics
- [DataCap Stats](https://datacapstats.io/) — Filecoin Plus allocations

## Status

Pre-alpha. Wiring lands in `v0.0.1`.
