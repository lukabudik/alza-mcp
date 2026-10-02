import { z } from "zod";
import { OUTPUT_SCHEMAS } from "./output-schemas.js";
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
      return server.registerTool(
        name,
        {
          title: "List a category's attribute filters",
          description:
            "List the attribute filters (facets) Alza defines for a category — brand, native contrast, panel type, refresh rate, screen diagonal, etc. — with their real filter values and product counts. " +
            "Works for any category; the set of attributes differs per category (a laptop category has RAM/CPU facets, a monitor category has panel/contrast facets, …). " +
            "Only groups with `filterable: true` (Alza's Checkbox-type facets — includes brand) can actually be used to filter `search_products` (pass their `values[].value_id` in `search_products`'s `filters`, or brand ids in `producer_ids`); groups with `filterable: false` are informational only — Alza's own slider-type facets (size, refresh rate, weight, brightness, port counts, …) have no discoverable URL/API filter, live-verified 2026-09-27 (see docs/gap-analysis.md). For those, compare candidates with `get_product`'s scraped `params` field instead. " +
            "Call this before using `search_products`'s `filters`/`producer_ids` to get real, valid ids — never guess them. Read-only.",
          inputSchema,
          outputSchema: OUTPUT_SCHEMAS["list_category_filters"],
          annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        },
        async (args) =>
          errorWrap(name, async () => {
            const groups = await deps.catalog.getFacets(args.category_id);
            return {
              content: [{ type: "text", text: formatCategoryFilters(groups) }],
              structuredContent: { category_id: args.category_id, groups: groups as unknown as Record<string, unknown>[] },
            };
          })
      );
    },
  };
}
