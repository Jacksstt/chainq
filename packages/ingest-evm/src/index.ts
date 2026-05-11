/**
 * @chainq/ingest-evm — EVM ingestion.
 *
 * Backfill uses cryo (must be installed separately, see README).
 * Realtime uses Subsquid (planned for v0.1.0).
 */

import type { ChainId } from "@chainq/core";

export interface BackfillOptions {
  chain: ChainId;
  rpcUrl: string;
  blockStart: number;
  blockEnd: number;
  outputDir: string;
  datasets?: ("blocks" | "transactions" | "logs" | "traces")[];
}

export async function backfill(_opts: BackfillOptions): Promise<void> {
  throw new Error("not implemented — wires to cryo in v0.0.1");
}
