/**
 * Static catalog of known tables.
 *
 * In v0.1+ this will be discovered from the dbt manifest. For v0.0.x we
 * hand-curate a small list so the agent has something to introspect.
 */

import type { TableDescriptor } from "@chainq/core";

export const CATALOG: TableDescriptor[] = [
  {
    name: "prices.usd",
    description:
      "Daily USD reference prices keyed by `(chain, token)`. Use this as a join partner for any " +
      "raw on-chain volume that needs USD enrichment. Sourced from upstream aggregators (Pyth / " +
      "DefiLlama / Coingecko in production; seeded synthetics in this build).",
    chains: ["ethereum", "base", "polygon", "arbitrum", "optimism"],
    columns: [
      { name: "price_time", type: "TIMESTAMP", description: "Snapshot timestamp (UTC, day-aligned).", nullable: false },
      { name: "token",      type: "VARCHAR",   description: "Symbol matching `dex.trades.token_in/out`.", nullable: false },
      { name: "chain",      type: "VARCHAR",   description: "Chain id.", nullable: false },
      { name: "price_usd",  type: "DOUBLE",    description: "Price in USD as of price_time. Decimal-applied.", nullable: false },
      { name: "source",     type: "VARCHAR",   description: "Provider tag (e.g. `pyth`, `defillama`, `chainq:synthetic`).", nullable: false },
    ],
    partitions: ["chain"],
    lineage: [
      {
        source: "External price feed aggregators (Pyth / DefiLlama / Coingecko in production).",
        transform: "Daily snapshots normalised to USD; symbol mapping handled in spellbook.",
        dbtModel: "models/prices/prices_usd.sql",
      },
    ],
    sampleQueries: [
      { title: "Latest price per token", sql: "SELECT token, price_usd FROM prices_usd WHERE price_time = (SELECT MAX(price_time) FROM prices_usd) ORDER BY price_usd DESC" },
      { title: "Stablecoin drift", sql: "SELECT price_time, token, price_usd FROM prices_usd WHERE token IN ('USDC','USDT','DAI') AND price_usd NOT BETWEEN 0.995 AND 1.005 ORDER BY price_time" },
    ],
    gotchas: [
      "`price_time` is day-aligned. To price an intraday trade exactly, use a per-block oracle (`pyth.prices` in production).",
      "Symbols are case-sensitive. `WETH` != `weth`; production deployments often canonicalise on lowercase.",
      "Synthetic build only covers the eight DEX tokens used in dex.trades.",
    ],
  },
  {
    name: "labels.addresses",
    description:
      "Address -> label registry. Each row is one (address, chain, label) assertion with a source " +
      "and confidence. Use for OFAC screening, exchange-flow analysis, MEV-bot filtering. Seeded " +
      "synthetics in this build; production wires Chainalysis / Etherscan tags / open OFAC SDN.",
    chains: ["ethereum", "base", "polygon", "arbitrum", "optimism"],
    columns: [
      { name: "address",    type: "VARCHAR", description: "0x-prefixed lowercase EVM address.", nullable: false },
      { name: "chain",      type: "VARCHAR", description: "Chain id.", nullable: false },
      { name: "label",      type: "VARCHAR", description: "Canonical tag: cex_hot_wallet / cex_cold_wallet / dex_router / mev_bot / bridge_operator / sanctioned / contract_factory / eoa_whale.", nullable: false },
      { name: "source",     type: "VARCHAR", description: "Source identifier (e.g. `OFAC SDN List`, `Etherscan tag`).", nullable: false },
      { name: "confidence", type: "DOUBLE",  description: "0..1 confidence. OFAC = 1.0; heuristic labels ~0.7-0.85.", nullable: false },
    ],
    partitions: ["chain"],
    lineage: [
      {
        source: "OFAC SDN List + Etherscan tags + Chainalysis (production); synthetic samples in this build.",
        transform: "Per-source normalisation, then union with conflict resolution by source priority + confidence.",
        dbtModel: "models/labels/labels_addresses.sql",
      },
    ],
    sampleQueries: [
      { title: "Sanctioned addresses", sql: "SELECT address, chain, source FROM labels_addresses WHERE label = 'sanctioned'" },
      { title: "CEX-bound transfer volume", sql: "SELECT l.label, SUM(TRY_CAST(t.value AS HUGEINT))::DOUBLE AS volume FROM erc20_transfers t JOIN labels_addresses l ON l.address = t.to_addr AND l.chain = t.chain WHERE l.label LIKE 'cex_%' GROUP BY 1 ORDER BY 2 DESC" },
    ],
    gotchas: [
      "Addresses stored lowercase; if you join with raw on-chain logs make sure both sides are normalised.",
      "Same address can have multiple rows in different sources. Aggregate to a primary tag if you need a single label.",
      "OFAC entries (`label = 'sanctioned'`) are regulatory-grade. Heuristic labels (`mev_bot`, `eoa_whale`) are best-effort.",
    ],
  },
  {
    name: "dex.trades",
    description:
      "DEX swap events normalized across aggregators (Uniswap V2/V3, Curve, Balancer, etc.). Each row is one swap on one chain.",
    chains: ["ethereum", "base", "polygon", "arbitrum", "optimism"],
    columns: [
      { name: "block_time", type: "TIMESTAMP", description: "When the trade was confirmed (UTC).", nullable: true },
      { name: "block_number", type: "BIGINT", description: "Block height.", nullable: true },
      { name: "chain", type: "VARCHAR", description: "Chain id (ethereum, base, …).", nullable: true },
      { name: "dex_name", type: "VARCHAR", description: "DEX protocol name.", nullable: true },
      { name: "tx_hash", type: "VARCHAR", description: "Transaction hash, 0x-prefixed.", nullable: true },
      { name: "taker", type: "VARCHAR", description: "Address that initiated the swap.", nullable: true },
      { name: "token_in", type: "VARCHAR", description: "Token sold.", nullable: true },
      { name: "token_out", type: "VARCHAR", description: "Token bought.", nullable: true },
      { name: "amount_in", type: "DECIMAL(21,1)", description: "Amount of token_in sold (human units, decimals applied). Returned as a precision-preserving decimal string.", nullable: true },
      { name: "amount_out", type: "DECIMAL(24,4)", description: "Amount of token_out bought. Returned as a decimal string.", nullable: true },
      { name: "amount_usd", type: "DECIMAL(23,2)", description: "USD-equivalent volume at trade time. NULL when the pricing oracle had no data. Returned as a decimal string.", nullable: true },
    ],
    sample: [
      {
        block_time: "2026-01-01T00:00:00Z",
        block_number: 18000000,
        chain: "ethereum",
        dex_name: "uniswap_v3",
        tx_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        taker: "0x0000000000000000000000000000000000000000",
        token_in: "WETH",
        token_out: "DAI",
        amount_in: "1.5",
        amount_out: "0.0012",
        amount_usd: "12.34",
      },
    ],
    gotchas: [
      "amount_usd may be NULL when the pricing oracle had no data at block_time.",
      "amount_in / amount_out / amount_usd are DECIMAL; over MCP they arrive as precision-preserving decimal strings, not numbers — use TRY_CAST to DOUBLE if you need float math.",
      "Avoid SELECT * over multi-year ranges without a chain filter — partitioning is by chain/year/month.",
      "Both \"dex.trades\" and dex_trades resolve to the same physical view; pick one and stay consistent for readability.",
    ],
    lineage: [
      {
        source: "Per-DEX raw swap event tables (Uniswap V2/V3, Curve, Balancer) ingested from public Subsquid archives.",
        transform: "Union + normalisation in the dbt-duckdb spellbook.",
        dbtModel: "models/dex/dex_trades.sql",
      },
    ],
    sampleQueries: [
      {
        title: "Trade count by chain",
        sql: "SELECT chain, COUNT(*) AS trades FROM dex_trades GROUP BY 1 ORDER BY 2 DESC",
      },
      {
        title: "Daily Base USD volume",
        sql: "SELECT date_trunc('day', block_time) AS day, SUM(amount_usd) AS volume_usd FROM dex_trades WHERE chain = 'base' GROUP BY 1 ORDER BY 1",
      },
    ],
    partitions: ["chain", "year", "month"],
  },
  {
    name: "erc20.transfers",
    description: "Raw ERC-20 Transfer events across supported EVM chains.",
    chains: ["ethereum", "base", "polygon", "arbitrum", "optimism"],
    columns: [
      { name: "block_time", type: "TIMESTAMP", description: "When the transfer occurred.", nullable: true },
      { name: "block_number", type: "BIGINT", description: "Block height.", nullable: true },
      { name: "chain", type: "VARCHAR", description: "Chain id.", nullable: true },
      { name: "tx_hash", type: "VARCHAR", description: "Transaction hash.", nullable: true },
      { name: "token", type: "VARCHAR", description: "ERC-20 contract address.", nullable: true },
      { name: "from_addr", type: "VARCHAR", description: "Sender.", nullable: true },
      { name: "to_addr", type: "VARCHAR", description: "Recipient.", nullable: true },
      { name: "value", type: "VARCHAR", description: "Raw token amount (UINT256 as decimal string).", nullable: true },
    ],
    gotchas: [
      "value is a decimal string, not a number — use TRY_CAST or hugeint for math.",
      "Token decimals are not applied here; join with tokens.erc20 metadata to normalize.",
    ],
    lineage: [
      {
        source: "Raw ERC-20 Transfer event logs ingested per chain from public Subsquid archives.",
        transform: "Decoded + normalised into a single union table in the dbt-duckdb spellbook.",
        dbtModel: "models/erc20/erc20_transfers.sql",
      },
    ],
    sampleQueries: [
      {
        title: "Most popular tokens by transfer count",
        sql: "SELECT token, COUNT(*) AS transfers FROM erc20_transfers GROUP BY 1 ORDER BY 2 DESC LIMIT 20",
      },
      {
        title: "Daily transfer count on Ethereum",
        sql: "SELECT date_trunc('day', block_time) AS day, COUNT(*) AS transfers FROM erc20_transfers WHERE chain = 'ethereum' GROUP BY 1 ORDER BY 1",
      },
    ],
    partitions: ["chain"],
  },
  {
    name: "filecoin.deals",
    description: "Filecoin storage deals captured from Filfox + Spacescan APIs.",
    chains: ["filecoin"],
    columns: [
      { name: "deal_id", type: "BIGINT", description: "Filecoin protocol deal id.", nullable: true },
      { name: "client", type: "VARCHAR", description: "Client (data owner) address.", nullable: true },
      { name: "provider", type: "VARCHAR", description: "Storage provider miner id (e.g. f0123456).", nullable: true },
      { name: "piece_size_bytes", type: "BIGINT", description: "Piece size in bytes.", nullable: true },
      { name: "start_epoch", type: "BIGINT", description: "Start epoch.", nullable: true },
      { name: "end_epoch", type: "BIGINT", description: "End epoch.", nullable: true },
      { name: "verified_deal", type: "BOOLEAN", description: "Whether the deal is a Filecoin Plus verified deal.", nullable: true },
    ],
    gotchas: [
      "Epochs are 30-second slots, not unix seconds. Convert via epoch * 30 + GENESIS_TIMESTAMP.",
      "GENESIS_TIMESTAMP is 1598306400 (2020-08-24 22:00:00 UTC).",
    ],
    lineage: [
      {
        source: "Filecoin storage deal records pulled from the Filfox and Spacescan public APIs.",
        transform: "Merged + deduplicated by deal_id in the dbt-duckdb spellbook.",
        dbtModel: "models/filecoin/filecoin_deals.sql",
      },
    ],
    sampleQueries: [
      {
        title: "Top providers by total bytes stored",
        sql: "SELECT provider, SUM(piece_size_bytes) AS bytes_stored FROM filecoin_deals GROUP BY 1 ORDER BY 2 DESC LIMIT 20",
      },
      {
        title: "Verified-deal share of total deals",
        sql: "SELECT verified_deal, COUNT(*) AS deals FROM filecoin_deals GROUP BY 1",
      },
    ],
    partitions: ["start_epoch"],
  },
  {
    name: "solana.transfers",
    description:
      "SPL token and native SOL transfers on Solana mainnet. One row per transfer instruction (including inner instructions).",
    chains: ["solana"],
    columns: [
      { name: "block_time", type: "TIMESTAMP", description: "When the transaction landed on chain (UTC).", nullable: true },
      { name: "slot", type: "BIGINT", description: "Solana slot at which the transfer was confirmed.", nullable: true },
      { name: "signature", type: "VARCHAR", description: "Base58-encoded transaction signature.", nullable: true },
      { name: "mint", type: "VARCHAR", description: "SPL token mint address. NULL for native SOL transfers.", nullable: true },
      { name: "from_account", type: "VARCHAR", description: "Source token account or system account.", nullable: true },
      { name: "to_account", type: "VARCHAR", description: "Destination token account or system account.", nullable: true },
      { name: "amount", type: "VARCHAR", description: "Raw u64 amount as a decimal string. Decimals NOT applied.", nullable: true },
      { name: "decimals", type: "INTEGER", description: "Mint decimals at time of transfer (9 for native SOL, typically 6 for stablecoins).", nullable: true },
    ],
    gotchas: [
      "Native SOL transfers have mint = NULL; their `amount` is in lamports (1e9 lamports = 1 SOL).",
      "`amount` is a decimal string. Use TRY_CAST to apply `decimals` before averaging.",
      "Solana has no `chain` column — every row is implicitly solana mainnet.",
    ],
    lineage: [
      {
        source: "Helius RPC enriched transactions endpoint via @chainq/ingest-solana",
        transform: "Normalised into per-transfer rows in spellbook/models/solana/solana_transfers.sql",
        dbtModel: "models/solana/solana_transfers.sql",
      },
    ],
    sampleQueries: [
      {
        title: "Top mints by transfer count over last N slots",
        sql: "SELECT mint, COUNT(*) AS transfers FROM solana_transfers WHERE slot >= (SELECT MAX(slot) - 100000 FROM solana_transfers) AND mint IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20",
      },
      {
        title: "Native SOL transfer volume per day",
        sql: "SELECT date_trunc('day', block_time) AS day, SUM(TRY_CAST(amount AS HUGEINT)) / 1e9 AS sol_volume FROM solana_transfers WHERE mint IS NULL GROUP BY 1 ORDER BY 1",
      },
    ],
    partitions: ["slot"],
  },
  {
    name: "solana.dex.trades",
    description:
      "Solana DEX swap events normalized across Jupiter, Orca Whirlpool, Raydium, Meteora DLMM, and Phoenix. One row per swap.",
    chains: ["solana"],
    columns: [
      { name: "block_time", type: "TIMESTAMP", description: "When the swap landed on chain (UTC).", nullable: true },
      { name: "slot", type: "BIGINT", description: "Solana slot.", nullable: true },
      { name: "signature", type: "VARCHAR", description: "Base58 transaction signature.", nullable: true },
      { name: "dex_name", type: "VARCHAR", description: "DEX protocol name (e.g. jupiter, orca_whirlpool, raydium_amm).", nullable: true },
      { name: "trader", type: "VARCHAR", description: "Wallet that initiated the swap.", nullable: true },
      { name: "token_in_mint", type: "VARCHAR", description: "Mint of the token sold.", nullable: true },
      { name: "token_out_mint", type: "VARCHAR", description: "Mint of the token bought.", nullable: true },
      { name: "amount_in", type: "DECIMAL(24,4)", description: "Amount of token_in sold (human units, decimals applied). Returned as a decimal string.", nullable: true },
      { name: "amount_out", type: "DECIMAL(24,4)", description: "Amount of token_out bought. Returned as a decimal string.", nullable: true },
      { name: "amount_usd", type: "DECIMAL(23,2)", description: "USD-equivalent volume at trade time. NULL when pricing was unavailable.", nullable: true },
    ],
    gotchas: [
      "amount_usd may be NULL when off-chain pricing was unavailable.",
      "Jupiter routes through multiple DEXes — `dex_name='jupiter'` rows represent the aggregator entrypoint, not the underlying venue.",
    ],
    lineage: [
      {
        source: "Helius RPC enriched transactions endpoint via @chainq/ingest-solana",
        transform: "Per-DEX swap events decoded and normalised in spellbook/models/solana/solana_dex_trades.sql",
        dbtModel: "models/solana/solana_dex_trades.sql",
      },
    ],
    sampleQueries: [
      {
        title: "Daily USD volume per dex_name",
        sql: "SELECT date_trunc('day', block_time) AS day, dex_name, SUM(amount_usd) AS volume_usd FROM solana_dex_trades WHERE amount_usd IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2",
      },
      {
        title: "Top traders by trade count",
        sql: "SELECT trader, COUNT(*) AS trades FROM solana_dex_trades GROUP BY 1 ORDER BY 2 DESC LIMIT 20",
      },
    ],
    partitions: ["slot"],
  },
];

export function findTable(name: string): TableDescriptor | undefined {
  return CATALOG.find((t) => t.name === name);
}

export function searchTables(query: string, chain?: string): TableDescriptor[] {
  const q = query.toLowerCase().trim();
  return CATALOG.filter((t) => {
    if (chain && !t.chains.includes(chain as never)) return false;
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
  });
}
