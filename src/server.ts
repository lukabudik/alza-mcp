import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Catalog } from "./domain/catalog.js";
import { Pickup } from "./domain/pickup.js";
import { Reviews } from "./domain/reviews.js";
import { AlzaBrowser } from "./infra/browser.js";
import { NotFoundError, UpstreamError } from "./infra/errors.js";
import { log } from "./infra/logger.js";
import { findProductPrompt } from "./prompts/find-product.js";
import { createProductResource } from "./resources/product.js";
import { createFindPickupPointsTool } from "./tools/find-pickup-points.js";
import { createGetProductTool } from "./tools/get-product.js";
import { createGetProductReviewsTool } from "./tools/get-product-reviews.js";
import { createListCategoriesTool } from "./tools/list-categories.js";
import { createSearchProductsTool } from "./tools/search-products.js";
import type { ToolResult } from "./tools/types.js";

const VERSION = "0.1.0";

export interface BuildOptions {
  baseUrl?: string;
  cdpUrl?: string;
}

export interface BuildResult {
  server: McpServer;
  /** Call on shutdown to release the browser. */
  close: () => Promise<void>;
}

export function buildServer(opts: BuildOptions = {}): BuildResult {
  const browser = new AlzaBrowser({ baseUrl: opts.baseUrl, cdpUrl: opts.cdpUrl });
  const catalog = new Catalog(browser);
  const reviews = new Reviews(browser, catalog);
  const pickup = new Pickup(browser.locale);
  const deps = { catalog, reviews, pickup };

  const server = new McpServer(
    { name: "alza-mcp", title: "Alza (unofficial)", version: VERSION },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      instructions:
        "Read-only catalog browser for Alza.cz, the Czech/CEE e-commerce retailer. " +
        "Unofficial — not affiliated with or endorsed by Alza.cz a.s. " +
        "Use search_products to find items, get_product for full detail, " +
        "get_product_reviews for ratings, find_pickup_points for nearby AlzaShop locations.",
    }
  );

  const errorWrap = async (name: string, fn: () => Promise<ToolResult>): Promise<ToolResult> => {
    try {
      return await fn();
    } catch (err) {
      const message = friendlyError(err);
      log.warn(`tool ${name} error`, { error: message });
      return { content: [{ type: "text", text: message }], isError: true };
    }
  };

  for (const tool of [
    createSearchProductsTool(deps),
    createGetProductTool(deps),
    createGetProductReviewsTool(deps),
    createFindPickupPointsTool(deps),
    createListCategoriesTool(deps),
  ]) {
    tool.register(server, errorWrap);
  }

  const productResource = createProductResource(catalog);
  server.registerResource(
    productResource.name,
    new ResourceTemplate(productResource.template, { list: undefined }),
    {
      title: productResource.title,
      description: productResource.description,
      mimeType: "application/json",
    },
    productResource.handler
  );

  server.registerPrompt(
    findProductPrompt.name,
    findProductPrompt.config,
    findProductPrompt.handler
  );

  return {
    server,
    close: () => browser.close(),
  };
}

function friendlyError(err: unknown): string {
  if (err instanceof NotFoundError) return err.message;
  if (err instanceof UpstreamError) {
    return `Alza upstream error (HTTP ${err.status}). ${err.message}`;
  }
  if (err instanceof Error) {
    if (err.message.includes("Timeout") || err.message.includes("timeout")) {
      return "Alza took too long to respond. The site may be slow right now — please retry.";
    }
    if (err.message.includes("net::") || err.message.includes("ERR_")) {
      return `Network error talking to Alza: ${err.message}`;
    }
    return `Error: ${err.message}`;
  }
  return "Unknown error";
}
