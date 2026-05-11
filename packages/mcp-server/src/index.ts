/**
 * Public surface of @chainq/mcp-server.
 */

export { startServer } from "./server.js";
export type { ServerOptions } from "./server.js";
export { Engine } from "./engine.js";
export type { EngineOptions } from "./engine.js";
export { CATALOG, findTable, searchTables } from "./catalog.js";
