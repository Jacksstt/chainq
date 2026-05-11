/**
 * @chainq/storage — share chainq Parquet snapshots over Filecoin / IPFS.
 *
 * Two operations:
 *
 *   push(path)  → uploads a Parquet file to a Filecoin gateway, returns its CID
 *   pull(cid)   → fetches a CID from a public IPFS gateway, writes a Parquet file
 *
 * Default gateway is lighthouse.storage. web3.storage is supported by passing
 * a different StorageProvider. No proprietary SDK dependency — both use plain
 * HTTPS.
 */

import { createReadStream, statSync, mkdirSync, createWriteStream } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { pipeline } from "node:stream/promises";

export interface PushOptions {
  filePath: string;
  /** Lighthouse API key (https://files.lighthouse.storage). */
  apiKey?: string;
  /** Override the gateway. */
  provider?: StorageProvider;
}

export interface PushResult {
  cid: string;
  size: number;
  name: string;
  provider: string;
}

export interface PullOptions {
  cid: string;
  /** Local destination path (file). */
  outPath: string;
  /** Override the gateway. */
  gatewayUrl?: string;
}

export interface PullResult {
  cid: string;
  outPath: string;
  bytes: number;
}

export interface StorageProvider {
  name: string;
  upload(filePath: string, apiKey?: string): Promise<{ cid: string; size: number }>;
}

/**
 * lighthouse.storage uploader. Streams the file with multipart/form-data.
 * Docs: https://docs.lighthouse.storage/
 */
export const lighthouseProvider: StorageProvider = {
  name: "lighthouse",
  async upload(filePath, apiKey) {
    if (!apiKey) throw new Error("LIGHTHOUSE_API_KEY required for lighthouse uploads");
    const form = new FormData();
    const blob = await fileToBlob(filePath);
    form.append("file", blob, basename(filePath));
    const resp = await fetch("https://node.lighthouse.storage/api/v0/add", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!resp.ok) {
      throw new Error(`lighthouse upload failed: ${resp.status} ${await resp.text()}`);
    }
    const payload = (await resp.json()) as { Hash?: string; Size?: string };
    if (!payload.Hash) throw new Error(`lighthouse response missing Hash: ${JSON.stringify(payload)}`);
    return { cid: payload.Hash, size: Number(payload.Size ?? 0) };
  },
};

/**
 * web3.storage / w3up uploader. Requires the user to have signed into a
 * Space and passed its DID + a delegation; that bootstrap is out of scope
 * for v0.0.x — we expose this provider as a stub.
 */
export const web3StorageProvider: StorageProvider = {
  name: "web3.storage",
  async upload() {
    throw new Error("web3.storage upload not yet implemented (use lighthouse for now)");
  },
};

export async function push(opts: PushOptions): Promise<PushResult> {
  const provider = opts.provider ?? lighthouseProvider;
  const filePath = resolve(opts.filePath);
  const stat = statSync(filePath);
  const result = await provider.upload(filePath, opts.apiKey);
  return {
    cid: result.cid,
    size: result.size || stat.size,
    name: basename(filePath),
    provider: provider.name,
  };
}

export async function pull(opts: PullOptions): Promise<PullResult> {
  const gateway = opts.gatewayUrl ?? "https://gateway.lighthouse.storage/ipfs";
  const url = `${gateway}/${opts.cid}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`pull failed: ${resp.status} ${url}`);
  const out = resolve(opts.outPath);
  mkdirSync(dirname(out), { recursive: true });
  if (!resp.body) throw new Error("pull failed: empty body");
  const writer = createWriteStream(out);
  // Cast to any to bridge web ReadableStream → node Writable in TS strict mode.
  await pipeline(resp.body as unknown as NodeJS.ReadableStream, writer);
  const bytes = statSync(out).size;
  return { cid: opts.cid, outPath: out, bytes };
}

/** Internal: wrap a file as a Blob (Node fetch wants this for multipart). */
async function fileToBlob(filePath: string): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const stream = createReadStream(filePath);
  for await (const chunk of stream) chunks.push(chunk as Uint8Array);
  return new Blob(chunks, { type: "application/octet-stream" });
}
