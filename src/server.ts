import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError } from "zod";
import { Catalog } from "./domain/catalog.js";
import { MobileAccount } from "./domain/mobile-account.js";
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
import { createListCategoryFiltersTool } from "./tools/list-category-filters.js";
import { createSearchProductsTool } from "./tools/search-products.js";
import { createAccountTools } from "./tools/account.js";
import { createAdvancedTools } from "./tools/advanced.js";
import { registerToolsets } from "./tools/toolsets.js";
import { MobileApi } from "./infra/mobile-api.js";
import { ImpersonateTransport, cfFetch } from "./infra/impersonate-transport.js";
import type { ToolResult } from "./tools/types.js";

const VERSION = "0.3.1";

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
  // Chrome-fingerprint sidecar (curl_cffi) — tried FIRST for the account stack:
  // it bypasses the Cloudflare bot wall without a browser (verified 2026-09-15).
  // Optional by design: no interpreter with curl_cffi → the transport is dead
  // and the existing chain (plain fetch → browser fallback) applies unchanged.
  const cfTransport = new ImpersonateTransport();
  // The browser transport backs the catalog AND the account stack's bot-challenge fallback
  // (same-origin /services/restservice.svc routes are JS-challenge-gated for plain fetch).
  const mobileApi = new MobileApi({
    baseUrl: opts.baseUrl,
    browser,
    httpFetch: cfTransport.available ? cfFetch(cfTransport) : undefined,
    fetchImpl: cfTransport.available ? cfFetch(cfTransport) : undefined,
  });
  const mobileAccount = new MobileAccount(mobileApi);
  const deps = { catalog, reviews, pickup, mobileAccount };

  const server = new McpServer(
    { name: "alza-mcp", title: "Alza (unofficial)", version: VERSION },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      instructions:
        "Alza.cz catalog and shopping assistant. Unofficial — not affiliated with or endorsed by Alza.cz a.s. " +
        "Tools are grouped into toolsets and only `catalog` + `auth` are enabled by default to keep the visible tool list small — call `list_toolsets` to see every group, then `set_toolset({id, enabled: true})` to turn on the one a task needs (e.g. `basket_and_checkout` before placing an order) before calling its tools. " +
        "Catalog (always on): `search_products` (keyword + filters) → `get_product` (detail) → `get_product_reviews` (reviews); `list_categories` for category ids; `find_pickup_points` for AlzaShop showrooms near a postal code. " +
        "Account & checkout (enable `basket_and_checkout`; OAuth token auto-loads from ~/.alza-mcp/tokens.json; check `account_status`): `cart`, `add_to_cart`, `delivery_options`, `select_pickup_point`, `checkout_preview` → `place_order` (mobile API), or the legacy web WCF path `web_add_to_cart` → `web_cart` → `web_pickup_places` → `web_place_order`. " +
        "Order submission currently works via the legacy web WCF path (`web_place_order`); the mobile `place_order` (sendOrder3) returns HTTP 500 (docs/gap-analysis.md G1/G5). Cancel with `cancel_order`. " +
        "Credentials are never collected by the MCP. High-impact mutations (payment, registration, address, review, subscription, attachment, order) require a one-time token from `prepare_mutation` (in the always-on `auth` toolset) — confirm with the user before calling them. " +
        "`mobile_read` (toolset `advanced_raw`) is the raw read-only escape hatch for mobile API operations without a dedicated tool.",
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

  registerToolsets(server, errorWrap, [
    createSearchProductsTool(deps),
    createGetProductTool(deps),
    createGetProductReviewsTool(deps),
    createFindPickupPointsTool(deps),
    createListCategoryFiltersTool(deps),
    createListCategoriesTool(deps),
    ...createAccountTools(deps),
    ...createAdvancedTools(deps),
  ]);

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
    close: () => {
      cfTransport.close();
      return browser.close();
    },
  };
}

function friendlyError(err: unknown): string {
  if (err instanceof NotFoundError) return err.message;
  if (err instanceof UpstreamError) {
    return `Alza upstream error (HTTP ${err.status}). ${err.message}`;
  }
  if (err instanceof ZodError) {
    const issues = err.issues
      .slice(0, 5)
      .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
      .join("; ");
    return `Invalid arguments — ${issues}`;
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
