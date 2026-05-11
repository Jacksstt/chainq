# @chainq/mcp-server

The Model Context Protocol server that exposes chainq's analytics surface to AI agents.

Pre-alpha. Real MCP SDK integration lands in `v0.0.1`.

## Tools exposed (target)

| Tool | Description |
|---|---|
| `search_tables` | Natural-language search across curated tables |
| `describe` | Full schema + sample rows + gotchas for a table |
| `list_metrics` | Enumerate the semantic-layer metrics |
| `estimate_cost` | Predicted rows, bytes, and runtime before execution |
| `query` | Run arbitrary SQL with budget caps |
| `metric` | Run a named metric from the semantic layer |
| `recall` | Vector search over previously executed queries |
| `chart_render` | Save a PNG / SVG chart from a result |
| `report` | Write a Markdown / HTML report to a vault directory |

## Use from Claude Code

```bash
claude mcp add chainq -- npx -y @chainq/mcp-server
```
