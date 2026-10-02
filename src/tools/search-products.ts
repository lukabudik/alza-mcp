import { z } from "zod";
import { OUTPUT_SCHEMAS } from "./output-schemas.js";
import { formatSearchResult } from "./format.js";
import type { RegisterableTool, ToolDeps } from "./types.js";

const inputSchema = {
  query: z.string().min(1).describe("Search keywords. Required. Example: 'iPhone 15 Pro', 'PlayStation 5', 'gaming mouse Logitech'."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum number of results to return. Default 20, max 50."),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "1-indexed result page (follows Alza's rendered pagination). Only pages Alza actually renders are reachable — a page beyond the rendered set returns no results rather than repeating page 1. Paginating this way does not change which page the sweep scans (sorting still scans from page 1)."
    ),
  sort: z
    .enum(["relevance", "price-asc", "price-desc", "rating", "newest"])
    .optional()
    .describe(
      "Sort order, default 'relevance'. Alza's search page ignores server-side sort parameters, so price (asc/desc) and rating sorts gather candidates from up to 3 result pages (~72 items — the top of Alza's relevance ranking) and sort them client-side; the response's `candidatesScanned` says how many candidates were scanned. 'newest' is best-effort (Alza's newest-sort is client-side JS, so it returns relevance order). For an absolute price floor, also pass `max_price` and/or narrow `category_id`."
    ),
  min_price: z.number().min(0).optional().describe("Minimum price in the locale's currency."),
  max_price: z.number().min(0).optional().describe("Maximum price in the locale's currency."),
  in_stock: z
    .boolean()
    .optional()
    .describe(
      "If true, keep only products purchasable right now (card shows a 'Do košíku'/'Vybrat variantu' purchase CTA; cards with a 'Hlídat' watch button are excluded). Derived from the search card's CTA — for real delivery dates use `get_product`."
    ),
  category_id: z
    .number()
    .int()
    .optional()
    .describe(
      "Restrict the search to a specific category id. Use list_categories to discover ids."
    ),
  min_screen_inches: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Minimum screen diagonal in inches, for display products (monitors, TVs, laptops). Parsed from the product name's leading size (e.g. '40\" MSI MAG401QR' → 40) — Alza's real diagonal filter is a client-side-only slider with no discoverable URL/API encoding, so this is a name-based substitute. A product whose name doesn't start with a size is excluded when this filter is set (can't verify it matches). Not meaningful for non-display categories."
    ),
  max_screen_inches: z
    .number()
    .min(0)
    .optional()
    .describe("Maximum screen diagonal in inches. See `min_screen_inches` for how this is derived and its limitations."),
  producer_ids: z
    .array(z.number().int().positive())
    .optional()
    .describe(
      "Filter by brand/producer id(s) — get real ids from `list_category_filters`'s `producers` group. Requires `category_id`. Works for any category (this is a real, live-verified Alza filter, not a heuristic)."
    ),
  filters: z
    .array(
      z.object({
        param_id: z.number().int().positive().describe("The facet's param_id from `list_category_filters`."),
        value_id: z.number().int().positive().describe("The chosen value's value_id from that facet's `values` list."),
      })
    )
    .optional()
    .describe(
      "Attribute filter selections — get real param_id/value_id pairs from `list_category_filters` (only groups with `filterable: true` work here; never guess ids). Requires `category_id`. Each entry ANDs a different facet group together (live-verified 2026-09-27, e.g. brand + HDMI-support combined correctly narrowed real Alza results)."
    ),
};

export function createSearchProductsTool(deps: ToolDeps): RegisterableTool {
  const name = "search_products";
  return {
    name,
    register(server, errorWrap) {
      return server.registerTool(
        name,
        {
          title: "Search Alza products",
          description:
            "Search the Alza.cz catalog by keyword. Use this for product discovery — finding what's available, comparing options, or starting research. Returns a list with product code, name, price, stock (from the card's purchase CTA), and rating. To get full details for one product, follow up with `get_product`. Sorting: Alza's search page ignores server-side sort, so price-asc / price-desc / rating scan up to ~72 top-ranked candidates (3 pages) and sort them client-side — `candidatesScanned` reports how many were scanned; for an absolute price floor also pass `max_price`. `in_stock: true` keeps only products with a live purchase CTA. " +
            "Attribute filtering works for ANY category via `filters`/`producer_ids` — call `list_category_filters({category_id})` first to see what's available and get real ids (never guess them), then pass them here alongside `category_id`; this switches the search to Alza's own filtered category-browse page (live-verified 2026-09-27), so results are exactly what the website itself would show. Only Checkbox-type facets support this (brand always does); Slider-type facets (screen size, refresh rate, weight, brightness, …) have no discoverable filter API — `list_category_filters` marks those `filterable: false`. " +
            "`min_screen_inches`/`max_screen_inches` remain a name-based substitute specifically for screen size, since that facet is Slider-type. For any other unfilterable attribute (contrast, panel type, etc.), compare shortlisted candidates with `get_product`'s scraped `params` field instead. " +
            "Read-only.",
          inputSchema,
          outputSchema: OUTPUT_SCHEMAS["search_products"],
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async (args) =>
          errorWrap(name, async () => {
            const result = await deps.catalog.searchProducts({
              query: args.query,
              limit: args.limit,
              page: args.page,
              sort: args.sort,
              minPrice: args.min_price,
              maxPrice: args.max_price,
              inStock: args.in_stock,
              categoryId: args.category_id,
              minScreenInches: args.min_screen_inches,
              maxScreenInches: args.max_screen_inches,
              producerIds: args.producer_ids,
              filters: args.filters?.map((f) => ({ paramId: f.param_id, valueId: f.value_id })),
            });
            return {
              content: [{ type: "text", text: formatSearchResult(result) }],
              structuredContent: {
                query: result.query,
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                candidatesScanned: result.candidatesScanned,
                products: result.products,
              },
            };
          })
      );
    },
  };
}
