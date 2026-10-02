import { z } from "zod";
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
      "Filter by brand id(s) — get real ids from `list_category_filters`'s `brands`. Requires `category_id`. Works in every category."
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
      "Attribute filter selections — real param_id/value_id pairs from `list_category_filters` (`filterable: true` groups only; never guess ids). Requires `category_id`. Combines with `producer_ids`. If Alza doesn't honour a filter, the call errors instead of returning unfiltered results."
    ),
};

export function createSearchProductsTool(deps: ToolDeps): RegisterableTool {
  const name = "search_products";
  return {
    name,
    register(server, errorWrap) {
      server.registerTool(
        name,
        {
          title: "Search Alza products",
          description:
            "Search the Alza.cz catalog by keyword. Use this for product discovery — finding what's available, comparing options, or starting research. Returns a list with product code, name, price, stock (from the card's purchase CTA), and rating. To get full details for one product, follow up with `get_product`. Sorting: Alza's search page ignores server-side sort, so price-asc / price-desc / rating scan up to ~72 top-ranked candidates (3 pages) and sort them client-side — `candidatesScanned` reports how many were scanned; for an absolute price floor also pass `max_price`. `in_stock: true` keeps only products with a live purchase CTA. " +
            "Brand/attribute filtering: call `list_category_filters({category_id})` for real ids, then pass `producer_ids` and/or `filters` with `category_id`. This switches to Alza's own filtered category page, so `query` is ignored and results match what the website shows; a filter Alza doesn't honour returns an error rather than unfiltered results. " +
            "`min_screen_inches`/`max_screen_inches` are a name-based substitute for screen size (a slider facet Alza can't filter by URL). For other unfilterable attributes, compare shortlisted candidates with `get_product`'s `params`. " +
            "Read-only.",
          inputSchema,
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
