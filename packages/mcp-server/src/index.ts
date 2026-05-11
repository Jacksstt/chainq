/**
 * Public surface of @chainq/mcp-server.
 */

export { startServer } from "./server.js";
export type { ServerOptions } from "./server.js";
export { Engine } from "./engine.js";
export type { EngineOptions, CacheEntry } from "./engine.js";
export { CATALOG, findTable, searchTables } from "./catalog.js";
export { MetricRegistry } from "./metrics.js";
export type { MetricSpec, MetricRenderArgs } from "./metrics.js";
export { renderChartSvg, saveChart } from "./charts.js";
export type { ChartSpec, ChartType } from "./charts.js";
export { writeReport, renderMarkdown, renderHtml, inferFormatFromExt as inferReportFormat } from "./report.js";
export type { ReportSpec, ReportSection, ReportFormat, ReportLocale, I18nString, Localizable } from "./report.js";
export { TOOL_CATALOG, describe as describeTool } from "./tool-catalog.js";
export type { ToolDoc } from "./tool-catalog.js";
export {
  concentrationSuite,
  distributionSummary,
  histogram,
  bucketize,
  percentile,
  computeGini,
  computeLorenz,
  lorenzChartData,
  histogramChartData,
  bucketChartData,
} from "./analytics.js";
export type {
  ConcentrationSuite,
  PercentileSummary,
  Histogram,
  BucketSpec,
  BucketResult,
} from "./analytics.js";
