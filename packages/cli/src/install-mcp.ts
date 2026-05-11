/**
 * `chainq install-mcp` — one-shot wizard that wires chainq's stdio MCP
 * server into popular MCP clients (Claude Code, Cursor, Cline, generic).
 *
 * Strategy:
 *   1. Resolve the chainq install root so we can hand the client an
 *      absolute path to `bin/chainq-mcp-stdio` (the launcher already
 *      shipped at the repo root).
 *   2. Find the client's config file (or accept `--config <path>`).
 *   3. Read the config, splice in / update an `mcpServers.chainq` entry.
 *   4. Write back atomically. Print the diff so the user knows what changed.
 *
 * Idempotent: re-running updates the entry rather than duplicating it.
 * Non-destructive: leaves all other MCP servers in the config alone.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, join } from "node:path";

export type McpClient = "claude-code" | "cursor" | "cline" | "generic";

export interface InstallMcpOptions {
  client: McpClient;
  /** Explicit config path. Overrides the per-client default. */
  configPath?: string;
  /** Override the chainq install root (defaults to packageRoot). */
  chainqRoot: string;
  /** Override the launcher path inside chainq. */
  launcherPath?: string;
  /** Optional CHAINQ_DATA_DIR to bake into the env block. */
  dataDir?: string;
  /** When true, write the change. When false, return the proposed file content only. */
  apply?: boolean;
}

export interface InstallMcpResult {
  configPath: string;
  /** Whether the file existed before (false = first-time install). */
  preExisting: boolean;
  /** The resulting MCP server entry as it appears in the config. */
  entry: Record<string, unknown>;
  /** Pretty-printed proposed config (for dry-run / display). */
  proposedConfig: string;
  /** True when `apply` was set and the file was rewritten. */
  written: boolean;
}

const DEFAULT_PATHS: Record<McpClient, string> = {
  // Claude Code's settings live under ~/.claude.
  "claude-code": "~/.claude/settings.json",
  // Cursor's MCP config (when MCP support lands generally) is under ~/.cursor/.
  "cursor": "~/.cursor/mcp.json",
  // Cline (VS Code extension) writes to the workspace OR globalState; the
  // globalState file path is documented as ~/.config/cline/cline_mcp_settings.json.
  "cline": "~/.config/cline/cline_mcp_settings.json",
  // Generic: a portable JSON file you can copy into any MCP client.
  "generic": "./chainq-mcp.json",
};

function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export function defaultConfigPath(client: McpClient): string {
  return expandHome(DEFAULT_PATHS[client]);
}

export function runInstallMcp(opts: InstallMcpOptions): InstallMcpResult {
  const launcher = opts.launcherPath ?? resolve(opts.chainqRoot, "bin/chainq-mcp-stdio");
  if (!existsSync(launcher)) {
    throw new Error(`launcher not found at ${launcher}. Did you run \`pnpm install\` and \`pnpm build\`?`);
  }
  const configPath = resolve(opts.configPath ?? defaultConfigPath(opts.client));
  const preExisting = existsSync(configPath);

  // Read / parse / merge.
  let existing: Record<string, unknown> = {};
  if (preExisting) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`config at ${configPath} is not valid JSON: ${(err as Error).message}`);
    }
  }

  const env: Record<string, string> = {};
  if (opts.dataDir) env.CHAINQ_DATA_DIR = resolve(opts.dataDir);

  // chainq entry — same shape across clients (mcpServers.chainq).
  const entry: Record<string, unknown> = {
    command: process.execPath, // node — chainq-mcp-stdio is a JS launcher
    args: [launcher],
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };

  // Merge under `mcpServers.chainq`. Preserve all other servers.
  const prior = (existing.mcpServers as Record<string, unknown> | undefined) ?? {};
  const merged: Record<string, unknown> = {
    ...existing,
    mcpServers: {
      ...prior,
      chainq: entry,
    },
  };
  const proposedConfig = JSON.stringify(merged, null, 2) + "\n";

  let written = false;
  if (opts.apply) {
    mkdirSync(dirname(configPath), { recursive: true });
    const tmp = configPath + ".chainq-tmp";
    writeFileSync(tmp, proposedConfig, "utf8");
    renameSync(tmp, configPath);
    written = true;
  }

  return { configPath, preExisting, entry, proposedConfig, written };
}
