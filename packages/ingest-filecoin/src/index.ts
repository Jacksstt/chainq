/**
 * @chainq/ingest-filecoin — Filecoin-native ingestion.
 *
 * Wraps Filfox REST and Spacescan REST. Native deals, miners, and sectors
 * are not on EVM and cannot be ingested via cryo.
 */

const FILFOX_BASE = "https://filfox.info/api/v1";
const SPACESCAN_BASE = "https://api.spacescan.io/v0";

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
  spacescanBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Fetch the most recent N deals from Filfox. This is a thin wrapper —
 * production ingest should checkpoint last-seen deal id and paginate.
 */
export async function fetchRecentDeals(
  opts: FetcherOptions,
  pageSize = 50,
): Promise<FilecoinDeal[]> {
  const base = opts.filfoxBaseUrl ?? FILFOX_BASE;
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  const response = await fetchImpl(`${base}/deal/list?pageSize=${pageSize}`);
  if (!response.ok) {
    throw new Error(`filfox /deal/list failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as { deals?: FilfoxDeal[] };
  return (payload.deals ?? []).map((d) => ({
    dealId: d.id,
    client: d.client,
    provider: d.provider,
    pieceSize: Number(d.pieceSize),
    startEpoch: d.startEpoch,
    endEpoch: d.endEpoch,
    verifiedDeal: Boolean(d.verifiedDeal),
  }));
}

export async function fetchMinerSnapshot(
  opts: FetcherOptions,
  pageSize = 50,
): Promise<FilecoinMiner[]> {
  const base = opts.spacescanBaseUrl ?? SPACESCAN_BASE;
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  const response = await fetchImpl(`${base}/miners?limit=${pageSize}`);
  if (!response.ok) {
    throw new Error(`spacescan /miners failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as { miners?: SpacescanMiner[] };
  return (payload.miners ?? []).map((m) => ({
    minerId: m.address,
    rawBytePower: BigInt(m.rawBytePower ?? "0"),
    qualityAdjPower: BigInt(m.qualityAdjPower ?? "0"),
    activeDeals: Number(m.activeDeals ?? 0),
  }));
}

interface FilfoxDeal {
  id: number;
  client: string;
  provider: string;
  pieceSize: string | number;
  startEpoch: number;
  endEpoch: number;
  verifiedDeal: boolean | number;
}

interface SpacescanMiner {
  address: string;
  rawBytePower?: string;
  qualityAdjPower?: string;
  activeDeals?: number;
}
