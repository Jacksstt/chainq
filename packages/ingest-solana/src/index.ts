/**
 * @chainq/ingest-solana — Solana data ingestion via Helius RPC.
 *
 * Helius exposes a regular Solana JSON-RPC endpoint plus enriched parser
 * endpoints. We use:
 *
 *   - getSignaturesForAddress  (paginated transaction discovery)
 *   - getTransaction           (per-tx detail)
 *   - /v0/addresses/.../transactions  (Helius enriched format with parsed
 *     SPL token transfers)
 *
 * Realtime via the Yellowstone gRPC firehose is a v0.3.0 target.
 */

export interface SolanaTxRow {
  signature: string;
  slot: number;
  block_time: string | null;
  fee_lamports: number;
  success: boolean;
  account_keys: string[];
}

export interface SolanaTokenTransferRow {
  signature: string;
  slot: number;
  block_time: string | null;
  mint: string;
  from_account: string;
  to_account: string;
  amount: string;
  decimals: number;
}

export interface HeliusClientOptions {
  apiKey: string;
  /** Defaults to mainnet. */
  cluster?: "mainnet-beta" | "devnet";
  fetch?: typeof globalThis.fetch;
}

export class HeliusClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly rpcUrl: string;
  private readonly enrichedBase: string;

  constructor(private readonly opts: HeliusClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    const cluster = opts.cluster ?? "mainnet-beta";
    this.rpcUrl =
      cluster === "mainnet-beta"
        ? `https://mainnet.helius-rpc.com/?api-key=${opts.apiKey}`
        : `https://devnet.helius-rpc.com/?api-key=${opts.apiKey}`;
    this.enrichedBase = `https://api.helius.xyz/v0/addresses`;
  }

  /**
   * Paginate `getSignaturesForAddress` for an account.
   */
  async signaturesFor(address: string, limit = 100): Promise<{ signature: string; slot: number; blockTime: number | null }[]> {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [address, { limit }],
    };
    const resp = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`helius rpc failed: ${resp.status}`);
    const payload = (await resp.json()) as { result?: { signature: string; slot: number; blockTime: number | null }[] };
    return payload.result ?? [];
  }

  /**
   * Helius enriched `/transactions` — already parses SPL token transfers, NFT
   * events, jupiter routes, and so on.
   */
  async enrichedTransactions(address: string, limit = 100): Promise<EnrichedTx[]> {
    const url = `${this.enrichedBase}/${address}/transactions?api-key=${this.opts.apiKey}&limit=${limit}`;
    const resp = await this.fetchImpl(url);
    if (!resp.ok) throw new Error(`helius enriched failed: ${resp.status}`);
    return (await resp.json()) as EnrichedTx[];
  }

  /**
   * Convenience: fetch enriched tx feed and project into SPL transfer rows.
   */
  async fetchTokenTransfers(address: string, limit = 100): Promise<SolanaTokenTransferRow[]> {
    const txs = await this.enrichedTransactions(address, limit);
    const rows: SolanaTokenTransferRow[] = [];
    for (const tx of txs) {
      for (const t of tx.tokenTransfers ?? []) {
        rows.push({
          signature: tx.signature,
          slot: tx.slot,
          block_time: tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : null,
          mint: t.mint,
          from_account: t.fromUserAccount,
          to_account: t.toUserAccount,
          amount: String(t.tokenAmount),
          decimals: t.tokenStandard === "Fungible" ? 9 : 0,
        });
      }
    }
    return rows;
  }
}

interface EnrichedTx {
  signature: string;
  slot: number;
  timestamp?: number;
  tokenTransfers?: {
    mint: string;
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    tokenStandard?: string;
  }[];
}
