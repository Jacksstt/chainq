# Supported chains

Reachability probe results. Generated 2026-05-11T21:33:34.710Z from
`scripts/probe-archives.ts` against every entry in
[`@chainq/snapshot/PUBLIC_ARCHIVES`](../packages/snapshot/src/index.ts).

Method: `GET <archiveUrl>/height`. `status: up` means HTTP 200 and the body parses as a positive integer (the archive head height). Anything else is `down` with the reason recorded.

**43 of 43 archives are currently reachable.**

Reproduce locally:

```bash
pnpm exec tsx scripts/probe-archives.ts --write
```

## UP (43)

| chain | head height | latency | archive URL |
|-------|------------:|--------:|-------------|
| `abstract` | 60,991,245 | 527 ms | https://v2.archive.subsquid.io/network/abstract-mainnet |
| `arbitrum` | 461,818,793 | 531 ms | https://v2.archive.subsquid.io/network/arbitrum-one |
| `arbitrum-nova` | 84,777,139 | 520 ms | https://v2.archive.subsquid.io/network/arbitrum-nova |
| `avalanche` | 85,192,238 | 512 ms | https://v2.archive.subsquid.io/network/avalanche-mainnet |
| `base` | 45,871,952 | 511 ms | https://v2.archive.subsquid.io/network/base-mainnet |
| `beam` | 8,842,015 | 509 ms | https://v2.archive.subsquid.io/network/beam-mainnet |
| `bera` | 20,759,387 | 510 ms | https://v2.archive.subsquid.io/network/berachain-mainnet |
| `blast` | 34,859,535 | 517 ms | https://v2.archive.subsquid.io/network/blast-l2-mainnet |
| `bnb` | 97,733,274 | 433 ms | https://v2.archive.subsquid.io/network/binance-mainnet |
| `canto` | 10,837,659 | 329 ms | https://v2.archive.subsquid.io/network/canto |
| `celo` | 66,627,895 | 459 ms | https://v2.archive.subsquid.io/network/celo-mainnet |
| `cyber` | 19,114,079 | 327 ms | https://v2.archive.subsquid.io/network/cyber-mainnet |
| `dfk-chain` | 46,801,213 | 329 ms | https://v2.archive.subsquid.io/network/dfk-chain |
| `dogechain` | 58,746,251 | 310 ms | https://v2.archive.subsquid.io/network/dogechain-mainnet |
| `ethereum` | 25,074,261 | 320 ms | https://v2.archive.subsquid.io/network/ethereum-mainnet |
| `flare` | 60,612,656 | 313 ms | https://v2.archive.subsquid.io/network/flare-mainnet |
| `gnosis` | 46,123,746 | 317 ms | https://v2.archive.subsquid.io/network/gnosis-mainnet |
| `hemi` | 4,367,065 | 311 ms | https://v2.archive.subsquid.io/network/hemi-mainnet |
| `hyperliquid` | 34,842,720 | 306 ms | https://v2.archive.subsquid.io/network/hyperliquid-mainnet |
| `ink` | 45,026,791 | 306 ms | https://v2.archive.subsquid.io/network/ink-mainnet |
| `linea` | 30,602,244 | 576 ms | https://v2.archive.subsquid.io/network/linea-mainnet |
| `manta` | 8,429,973 | 304 ms | https://v2.archive.subsquid.io/network/manta-pacific |
| `mantle` | 95,160,106 | 343 ms | https://v2.archive.subsquid.io/network/mantle-mainnet |
| `merlin` | 28,976,900 | 349 ms | https://v2.archive.subsquid.io/network/merlin-mainnet |
| `metis` | 20,764,719 | 326 ms | https://v2.archive.subsquid.io/network/metis-mainnet |
| `mode` | 39,175,812 | 319 ms | https://v2.archive.subsquid.io/network/mode-mainnet |
| `monad` | 73,965,494 | 317 ms | https://v2.archive.subsquid.io/network/monad-mainnet |
| `moonbeam` | 15,580,335 | 325 ms | https://v2.archive.subsquid.io/network/moonbeam-mainnet |
| `moonriver` | 16,216,520 | 314 ms | https://v2.archive.subsquid.io/network/moonriver-mainnet |
| `okx` | 59,756,982 | 289 ms | https://v2.archive.subsquid.io/network/xlayer-mainnet |
| `optimism` | 151,467,341 | 288 ms | https://v2.archive.subsquid.io/network/optimism-mainnet |
| `plume` | 67,521,931 | 295 ms | https://v2.archive.subsquid.io/network/plume |
| `polygon` | 86,739,191 | 300 ms | https://v2.archive.subsquid.io/network/polygon-mainnet |
| `polygon-zkevm` | 31,967,308 | 283 ms | https://v2.archive.subsquid.io/network/polygon-zkevm-mainnet |
| `scroll` | 14,808,251 | 299 ms | https://v2.archive.subsquid.io/network/scroll-mainnet |
| `shibarium` | 16,627,791 | 299 ms | https://v2.archive.subsquid.io/network/shibarium |
| `soneium` | 22,698,847 | 299 ms | https://v2.archive.subsquid.io/network/soneium-mainnet |
| `sonic` | 70,207,425 | 343 ms | https://v2.archive.subsquid.io/network/sonic-mainnet |
| `taiko` | 6,019,292 | 309 ms | https://v2.archive.subsquid.io/network/taiko-mainnet |
| `tron` | 82,132,914 | 503 ms | https://v2.archive.subsquid.io/network/tron-mainnet |
| `unichain` | 47,786,007 | 459 ms | https://v2.archive.subsquid.io/network/unichain-mainnet |
| `zksync` | 69,994,249 | 435 ms | https://v2.archive.subsquid.io/network/zksync-mainnet |
| `zora` | 45,865,328 | 444 ms | https://v2.archive.subsquid.io/network/zora-mainnet |

## Non-EVM ingest paths (counted separately)

These chains are NOT in `PUBLIC_ARCHIVES` (Subsquid doesn't index them) but chainq supports them via dedicated ingest packages:

| chain | package | public API |
|-------|---------|------------|
| `solana` | `@chainq/ingest-solana` | Helius RPC (free tier available) |
| `filecoin` | `@chainq/ingest-filecoin` | Filfox + Spacescan REST (no key) |

Total chains supported end-to-end: **45** (43 EVM via Subsquid + Solana + Filecoin).

## Adding a chain

1. Find the archive slug on https://docs.sqd.dev/subsquid-network/reference/networks/
2. Append the entry to `packages/snapshot/src/index.ts` `PUBLIC_ARCHIVES`
3. Re-run this script: `pnpm exec tsx scripts/probe-archives.ts --write`

Once a chain shows up in the **UP** table, you can immediately run:

```bash
chainq pull --chain <slug> --from N --to M
chainq watch --chain <slug> --from N
```