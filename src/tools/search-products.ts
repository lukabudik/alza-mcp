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
    .describe("1-indexed page number for paginating beyond `limit` results."),
  sort: z
    .enum(["relevance", "price-asc", "price-desc", "rating", "newest"])
    .optional()
    .describe("Sort order. Default 'relevance'."),
  min_price: z.number().min(0).optional().describe("Minimum price in the locale's currency."),
  max_price: z.number().min(0).optional().describe("Maximum price in the locale's currency."),
  in_stock: z
    .boolean()
    .optional()
    .describe("If true, only return products that are available right now."),
  category_id: z
    .number()
    .int()
    .optional()
    .describe(
      "Restrict the search to a specific category id. Use list_categories to discover ids."
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
            "Search the Alza.cz catalog by keyword. Use this for product discovery — finding what's available, comparing options, or starting research. Returns a list with product code, name, price, availability, and rating. To get full details for one product, follow up with `get_product`.",
          inputSchema,
          annotations: {
            readOnlyHint: true,
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
            });
            return {
              content: [{ type: "text", text: formatSearchResult(result) }],
              structuredContent: {
                query: result.query,
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                products: result.products,
              },
            };
          })
      );
    },
  };
}
