import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Catalog } from "../domain/catalog.js";
import type { Reviews } from "../domain/reviews.js";
import type { Pickup } from "../domain/pickup.js";

export interface ToolDeps {
  catalog: Catalog;
  reviews: Reviews;
  pickup: Pickup;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * A tool factory returns a `register` closure. Each tool keeps its own
 * Zod schema type narrow — by the time `register(server)` runs, the SDK
 * call is fully concrete.
 */
export interface RegisterableTool {
  name: string;
  register(server: McpServer, errorWrap: (name: string, fn: () => Promise<ToolResult>) => Promise<ToolResult>): void;
}
