/**
 * @chainq/ingest-evm — EVM data ingestion via cryo.
 *
 * cryo (https://github.com/paradigmxyz/cryo) is a Rust binary that streams
 * EVM datasets to Parquet. We shell out to it rather than re-implement the
 * extraction. The wrapper:
 *
 *   - asserts cryo is installed and prints an actionable error if not
 *   - builds the right argv for blocks / txs / logs / traces
 *   - lets you specify the output dir
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { ChainId } from "@chainq/core";

const execFileAsync = promisify(execFile);

export type CryoDataset = "blocks" | "transactions" | "logs" | "traces";

export interface BackfillOptions {
  chain: ChainId;
  rpcUrl: string;
  blockStart: number;
  blockEnd: number;
  outputDir: string;
  datasets?: CryoDataset[];
  /** Override the cryo binary location (defaults to PATH lookup). */
  cryoPath?: string;
  /** Forwarded to cryo --requests-per-second. */
  rps?: number;
}

export interface BackfillResult {
  outputDir: string;
  datasets: CryoDataset[];
  stdoutTail: string;
}

/**
 * Probe the cryo binary; throws with a helpful message if missing.
 */
export async function assertCryoInstalled(cryoPath = "cryo"): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cryoPath, ["--version"]);
    return stdout.trim();
  } catch {
    throw new Error(
      [
        "cryo is not installed or not on PATH.",
        "Install with one of:",
        "  cargo install cryo_cli",
        "  brew install paradigmxyz/brew/cryo",
        "Then re-run chainq.",
      ].join("\n"),
    );
  }
}

export async function backfill(opts: BackfillOptions): Promise<BackfillResult> {
  await assertCryoInstalled(opts.cryoPath);

  const outputDir = resolve(opts.outputDir);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const datasets = opts.datasets ?? ["blocks", "transactions", "logs"];
  const args: string[] = [
    ...datasets,
    "--blocks",
    `${opts.blockStart}:${opts.blockEnd}`,
    "--rpc",
    opts.rpcUrl,
    "--output-dir",
    outputDir,
    "--output-format",
    "parquet",
  ];
  if (opts.rps) args.push("--requests-per-second", String(opts.rps));

  const tail: string[] = [];
  const child = spawn(opts.cryoPath ?? "cryo", args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => {
    tail.push(chunk.toString());
    while (tail.join("").length > 4096) tail.shift();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    tail.push(chunk.toString());
    while (tail.join("").length > 4096) tail.shift();
  });

  await new Promise<void>((res, rej) => {
    child.on("error", rej);
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`cryo exited with ${code}`))));
  });

  return { outputDir, datasets, stdoutTail: tail.join("") };
}
