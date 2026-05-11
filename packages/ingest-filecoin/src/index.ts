/**
 * @chainq/ingest-filecoin — Filecoin-native ingestion.
 *
 * Wraps Filfox, Glif (Lotus RPC), and Spacescan REST APIs.
 * Filecoin native data (storage deals, miners, sectors) is not on EVM and
 * cannot be ingested via cryo / Subsquid.
 */

export interface FilecoinDeal {
  dealId: number;
  client: string;
  provider: string;
  pieceSize: number;
  startEpoch: number;
  endEpoch: number;
  verifiedDeal: boolean;
}

export interface FilecoinMiner {
  minerId: string;
  rawBytePower: bigint;
  qualityAdjPower: bigint;
  activeDeals: number;
}

export interface FetcherOptions {
  filfoxBaseUrl?: string;
  glifBaseUrl?: string;
  spacescanBaseUrl?: string;
  outputDir: string;
}

export async function fetchRecentDeals(_opts: FetcherOptions, _hours: number): Promise<FilecoinDeal[]> {
  throw new Error("not implemented — Filfox client wiring lands in v0.0.1");
}

export async function fetchMinerSnapshot(_opts: FetcherOptions): Promise<FilecoinMiner[]> {
  throw new Error("not implemented — Filfox/Spacescan client wiring lands in v0.0.1");
}
