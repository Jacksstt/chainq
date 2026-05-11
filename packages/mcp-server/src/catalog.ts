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
      { name: "block_time", type: "TIMESTAMP", description: "When the trade was confirmed (UTC).", nullable: false },
      { name: "block_number", type: "BIGINT", description: "Block height.", nullable: false },
      { name: "chain", type: "VARCHAR", description: "Chain id (ethereum, base, …).", nullable: false },
      { name: "dex_name", type: "VARCHAR", description: "DEX protocol name.", nullable: false },
      { name: "tx_hash", type: "VARCHAR", description: "Transaction hash, 0x-prefixed.", nullable: false },
      { name: "taker", type: "VARCHAR", description: "Address that initiated the swap.", nullable: false },
      { name: "token_in", type: "VARCHAR", description: "Token sold.", nullable: false },
      { name: "token_out", type: "VARCHAR", description: "Token bought.", nullable: false },
      { name: "amount_in", type: "DOUBLE", description: "Amount of token_in sold (human units, decimals applied).", nullable: false },
      { name: "amount_out", type: "DOUBLE", description: "Amount of token_out bought.", nullable: false },
      { name: "amount_usd", type: "DOUBLE", description: "USD-equivalent volume at trade time.", nullable: true },
    ],
    sample: [
      {
        block_time: "2026-05-01T12:34:56Z",
        chain: "base",
        dex_name: "uniswap_v3",
        token_in: "USDC",
        token_out: "WETH",
        amount_in: 1234.56,
        amount_out: 0.412,
        amount_usd: 1234.56,
      },
    ],
    gotchas: [
      "amount_usd may be NULL when the pricing oracle had no data at block_time.",
      "Rows are deduplicated by (tx_hash, log_index); use both for joins.",
      "Avoid SELECT * over multi-year ranges without a chain filter — partitioning is by chain/year/month.",
    ],
  },
  {
    name: "erc20.transfers",
    description: "Raw ERC-20 Transfer events across supported EVM chains.",
    chains: ["ethereum", "base", "polygon", "arbitrum", "optimism"],
    columns: [
      { name: "block_time", type: "TIMESTAMP", description: "When the transfer occurred.", nullable: false },
      { name: "block_number", type: "BIGINT", description: "Block height.", nullable: false },
      { name: "chain", type: "VARCHAR", description: "Chain id.", nullable: false },
      { name: "tx_hash", type: "VARCHAR", description: "Transaction hash.", nullable: false },
      { name: "token", type: "VARCHAR", description: "ERC-20 contract address.", nullable: false },
      { name: "from_addr", type: "VARCHAR", description: "Sender.", nullable: false },
      { name: "to_addr", type: "VARCHAR", description: "Recipient.", nullable: false },
      { name: "value", type: "VARCHAR", description: "Raw token amount (UINT256 as decimal string).", nullable: false },
    ],
    gotchas: [
      "value is a decimal string, not a number — use TRY_CAST or hugeint for math.",
      "Token decimals are not applied here; join with tokens.erc20 metadata to normalize.",
    ],
  },
  {
    name: "filecoin.deals",
    description: "Filecoin storage deals captured from Filfox + Spacescan APIs.",
    chains: ["filecoin"],
    columns: [
      { name: "deal_id", type: "BIGINT", description: "Filecoin protocol deal id.", nullable: false },
      { name: "client", type: "VARCHAR", description: "Client (data owner) address.", nullable: false },
      { name: "provider", type: "VARCHAR", description: "Storage provider miner id (e.g. f0123456).", nullable: false },
      { name: "piece_size_bytes", type: "BIGINT", description: "Piece size in bytes.", nullable: false },
      { name: "start_epoch", type: "BIGINT", description: "Start epoch.", nullable: false },
      { name: "end_epoch", type: "BIGINT", description: "End epoch.", nullable: false },
      { name: "verified_deal", type: "BOOLEAN", description: "Whether the deal is a Filecoin Plus verified deal.", nullable: false },
    ],
    gotchas: [
      "Epochs are 30-second slots, not unix seconds. Convert via epoch * 30 + GENESIS_TIMESTAMP.",
      "GENESIS_TIMESTAMP is 1598306400 (2020-08-24 22:00:00 UTC).",
    ],
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
