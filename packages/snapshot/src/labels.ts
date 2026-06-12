/**
 * @chainq/snapshot — pluggable OSS address-label providers.
 *
 * The point: populate `labels.addresses.parquet` from REAL public sources
 * instead of the synthetic seed, so the `labels_addresses` dbt model and the
 * `sanctioned_transfer_exposure` metric run against real labels.
 *
 * A {@link LabelProvider} fetches a list of {@link AddressLabel} rows. The
 * built-ins below are network-free except {@link ofacSdnProvider}, which pulls
 * the community-maintained machine-readable OFAC list and falls back to a
 * bundled fixture when offline. {@link syncLabels} runs a set of providers,
 * dedupes by (address|chain|label), and writes one Parquet file with the exact
 * columns `labels_addresses.sql` expects: address, chain, label, source,
 * confidence.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** One (address, chain, label) assertion with provenance + confidence. */
export interface AddressLabel {
  address: string;
  chain: string;
  label: string;
  source: string;
  confidence: number;
}

/** A pluggable source of address labels. */
export interface LabelProvider {
  name: string;
  provide(opts?: { fetch?: typeof globalThis.fetch }): Promise<AddressLabel[]>;
}

// OP-Stack L2s that share the canonical predeploy address set.
const OP_STACK_CHAINS = ["base", "optimism", "zora", "mode"] as const;

// Canonical OP-Stack predeploys (same address on every OP-Stack L2).
// Ref: github.com/ethereum-optimism/optimism — predeploy addresses.
const OP_STACK_PREDEPLOYS: { address: string; label: string }[] = [
  { address: "0x4200000000000000000000000000000000000006", label: "weth" }, // WETH9
  { address: "0x4200000000000000000000000000000000000007", label: "system" }, // L2CrossDomainMessenger
  { address: "0x4200000000000000000000000000000000000010", label: "bridge" }, // L2StandardBridge
  { address: "0x4200000000000000000000000000000000000016", label: "system" }, // L2ToL1MessagePasser
  { address: "0x4200000000000000000000000000000000000015", label: "system" }, // L1Block
];

/**
 * Canonical OP-Stack L2 predeploys (WETH, bridge, system contracts) replicated
 * across every OP-Stack chain. Network-free; confidence 1.0.
 */
export const predeployProvider: LabelProvider = {
  name: "op-stack-predeploy",
  async provide(): Promise<AddressLabel[]> {
    const out: AddressLabel[] = [];
    for (const chain of OP_STACK_CHAINS) {
      for (const p of OP_STACK_PREDEPLOYS) {
        out.push({
          address: p.address.toLowerCase(),
          chain,
          label: p.label,
          source: "op-stack-predeploy",
          confidence: 1.0,
        });
      }
    }
    return out;
  },
};

// Curated major-token map. Keyed by chain; each entry is (address, label).
const KNOWN_TOKENS: Record<string, { address: string; label: string }[]> = {
  base: [
    { address: "0x4200000000000000000000000000000000000006", label: "weth" },
    { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", label: "stablecoin" }, // USDC
  ],
  ethereum: [
    { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", label: "weth" }, // WETH
    { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", label: "stablecoin" }, // USDC
    { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", label: "stablecoin" }, // USDT
    { address: "0x6b175474e89094c44da98b954eedeac495271d0f", label: "stablecoin" }, // DAI
  ],
};

/**
 * A small curated map of major tokens (WETH + stablecoins) per chain.
 * Network-free; confidence 0.9.
 */
export const knownTokenProvider: LabelProvider = {
  name: "chainq-curated",
  async provide(): Promise<AddressLabel[]> {
    const out: AddressLabel[] = [];
    for (const chain of Object.keys(KNOWN_TOKENS)) {
      for (const t of KNOWN_TOKENS[chain] ?? []) {
        out.push({
          address: t.address.toLowerCase(),
          chain,
          label: t.label,
          source: "chainq-curated",
          confidence: 0.9,
        });
      }
    }
    return out;
  },
};

// ERC-4337 EntryPoint singletons — same address across every EVM chain.
const ENTRYPOINT_CHAINS = ["ethereum", "base", "optimism", "arbitrum", "polygon"] as const;
const ENTRYPOINTS = [
  "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789", // v0.6
  "0x0000000071727de22e5e9d8baf0edac6f37da032", // v0.7
];

/**
 * ERC-4337 EntryPoint contracts (v0.6 + v0.7) deployed at the same address on
 * every supported EVM chain. Network-free; confidence 1.0.
 */
export const entryPointProvider: LabelProvider = {
  name: "erc4337",
  async provide(): Promise<AddressLabel[]> {
    const out: AddressLabel[] = [];
    for (const chain of ENTRYPOINT_CHAINS) {
      for (const addr of ENTRYPOINTS) {
        out.push({
          address: addr.toLowerCase(),
          chain,
          label: "erc4337_entrypoint",
          source: "erc4337",
          confidence: 1.0,
        });
      }
    }
    return out;
  },
};

// Chains the OFAC SDN addresses are projected onto (EOAs/contracts may exist
// cross-chain, so a sanctioned address is flagged on each).
const OFAC_CHAINS = ["ethereum", "base", "optimism", "arbitrum", "polygon"] as const;

// Community-maintained machine-readable OFAC sanctioned ETH address list.
const OFAC_LIST_URL =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Parse a newline-delimited address list: trim, drop blanks/`#` comments. */
function parseAddressList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (ADDRESS_RE.test(line)) out.push(line.toLowerCase());
  }
  return out;
}

/** Read the bundled offline fixture, resolved relative to this module. */
function readOfacFixture(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "fixtures", "ofac-eth-sample.txt"), "utf8");
}

/**
 * OFAC SDN sanctioned addresses. Fetches the community machine-readable list;
 * on ANY error (offline / non-200) falls back to a bundled fixture so the
 * `sanctioned` label is always present. Each address is projected onto every
 * {@link OFAC_CHAINS} entry. Confidence 1.0.
 */
export const ofacSdnProvider: LabelProvider = {
  name: "OFAC SDN",
  async provide(opts?: { fetch?: typeof globalThis.fetch }): Promise<AddressLabel[]> {
    const fetchFn = opts?.fetch ?? globalThis.fetch;
    let text: string;
    try {
      const res = await fetchFn(OFAC_LIST_URL);
      if (!res.ok) throw new Error(`OFAC list HTTP ${res.status}`);
      text = await res.text();
    } catch {
      text = readOfacFixture();
    }
    const addresses = parseAddressList(text);
    const out: AddressLabel[] = [];
    for (const address of addresses) {
      for (const chain of OFAC_CHAINS) {
        out.push({ address, chain, label: "sanctioned", source: "OFAC SDN", confidence: 1.0 });
      }
    }
    return out;
  },
};

/** Default provider set used by {@link syncLabels} and the `labels sync` CLI. */
export const DEFAULT_PROVIDERS: LabelProvider[] = [
  predeployProvider,
  knownTokenProvider,
  entryPointProvider,
  ofacSdnProvider,
];

export interface SyncLabelsOptions {
  /** Providers to run (default: {@link DEFAULT_PROVIDERS}). */
  providers?: LabelProvider[];
  /** Directory to write Parquet to (default ./data). */
  outDir?: string;
  /** Injectable fetch (passed to each provider; for testing/offline). */
  fetch?: typeof globalThis.fetch;
}

export interface SyncLabelsResult {
  outputPath: string;
  count: number;
  bySource: Record<string, number>;
}

/**
 * Run the configured providers, concatenate + dedupe by (address|chain|label),
 * and write `<outDir>/labels.addresses.parquet` with columns address VARCHAR,
 * chain VARCHAR, label VARCHAR, source VARCHAR, confidence DOUBLE — exactly
 * what `spellbook/models/labels/labels_addresses.sql` reads.
 */
export async function syncLabels(opts?: SyncLabelsOptions): Promise<SyncLabelsResult> {
  const providers = opts?.providers ?? DEFAULT_PROVIDERS;
  const outDir = resolve(opts?.outDir ?? "./data");
  mkdirSync(outDir, { recursive: true });
  const outputPath = join(outDir, "labels.addresses.parquet");

  // Run providers sequentially and concatenate. The first writer of a given
  // (address|chain|label) key wins on dedupe (provider order = precedence).
  const all: AddressLabel[] = [];
  for (const provider of providers) {
    const rows = await provider.provide(opts?.fetch ? { fetch: opts.fetch } : {});
    for (const r of rows) all.push(r);
  }

  const seen = new Set<string>();
  const deduped: AddressLabel[] = [];
  for (const r of all) {
    const key = `${r.address}|${r.chain}|${r.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  await writeLabelsParquet(deduped, outputPath);

  const bySource: Record<string, number> = {};
  for (const r of deduped) bySource[r.source] = (bySource[r.source] ?? 0) + 1;

  return { outputPath, count: deduped.length, bySource };
}

/**
 * Write label rows to a zstd Parquet file with the column types the dbt model
 * expects. One transaction around the inserts — same pattern as
 * `writeLogsParquet` in `index.ts`.
 */
async function writeLabelsParquet(rows: AddressLabel[], outputPath: string): Promise<void> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await conn.run(`
    CREATE TABLE labels_addresses (
      address    VARCHAR,
      chain      VARCHAR,
      label      VARCHAR,
      source     VARCHAR,
      confidence DOUBLE
    )
  `);
  await conn.run("BEGIN TRANSACTION");
  for (const r of rows) {
    await conn.run(`INSERT INTO labels_addresses VALUES (?, ?, ?, ?, CAST(? AS DOUBLE))`, [
      r.address,
      r.chain,
      r.label,
      r.source,
      r.confidence,
    ]);
  }
  await conn.run("COMMIT");
  await conn.run(
    `COPY labels_addresses TO '${outputPath}' (FORMAT 'parquet', COMPRESSION 'zstd')`,
  );
  conn.disconnectSync();
}
