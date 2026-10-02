import { z } from "zod";
import { formatCategoryFilters } from "./format.js";
import type { RegisterableTool, ToolDeps } from "./types.js";

const inputSchema = {
  category_id: z
    .number()
    .int()
    .describe("Category id to read attribute filters for (from `list_categories` or `search_products`'s results)."),
};

export function createListCategoryFiltersTool(deps: ToolDeps): RegisterableTool {
  const name = "list_category_filters";
  return {
    name,
    register(server, errorWrap) {
      server.registerTool(
        name,
        {
          title: "List a category's filters",
          description:
            "List the brands and attribute filters (facets) Alza defines for a category, with real ids and product counts. " +
            "The attribute set differs per category (laptops have CPU/RAM facets, monitors have panel/resolution facets, …). " +
            "Pass `brands[].value_id` to `search_products` as `producer_ids` (brand filtering works in every category), and `filterable: true` groups' `param_id`/`value_id` pairs as `filters`. " +
            "Not every filterable facet is honoured by Alza — when one isn't, `search_products` returns an error rather than unfiltered results; drop that filter and compare candidates with `get_product`'s `params` instead. " +
            "`filterable: false` groups (sliders: size, refresh rate, weight, …) are informational only. " +
            "Call this before using `producer_ids`/`filters` — never guess ids. Read-only.",
          inputSchema,
          annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        },
        async (args) =>
          errorWrap(name, async () => {
            const filters = await deps.catalog.getCategoryFilters(args.category_id);
            return {
              content: [{ type: "text", text: formatCategoryFilters(filters) }],
              structuredContent: { ...filters },
            };
          })
      );
    },
  };
}
