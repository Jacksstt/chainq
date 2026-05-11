/**
 * @chainq/mcp-server — MCP tools that expose chainq to AI agents.
 *
 * Currently a placeholder. Real MCP SDK wiring lands in v0.0.1.
 */

import type {
  QueryEstimate,
  QueryResult,
  TableDescriptor,
  MetricDescriptor,
} from "@chainq/core";

export interface ChainqMcpServer {
  searchTables(query: string, chain?: string): Promise<TableDescriptor[]>;
  describe(table: string): Promise<TableDescriptor>;
  listMetrics(): Promise<MetricDescriptor[]>;
  estimateCost(sql: string): Promise<QueryEstimate>;
  query(sql: string, maxRows?: number, timeoutSeconds?: number): Promise<QueryResult>;
}

export function createServer(): ChainqMcpServer {
  return {
    async searchTables(_query, _chain) {
      throw new Error("not implemented");
    },
    async describe(_table) {
      throw new Error("not implemented");
    },
    async listMetrics() {
      throw new Error("not implemented");
    },
    async estimateCost(_sql) {
      throw new Error("not implemented");
    },
    async query(_sql, _maxRows, _timeoutSeconds) {
      throw new Error("not implemented");
    },
  };
}
