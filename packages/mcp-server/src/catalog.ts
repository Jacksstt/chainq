/**
 * Static catalog of known tables.
 *
 * In v0.1+ this will be discovered from the dbt manifest. For v0.0.x we
 * hand-curate a small list so the agent has something to introspect.
 */

import type { TableDescriptor } from "@chainq/core";

export const CATALOG: TableDescriptor[] = [
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
