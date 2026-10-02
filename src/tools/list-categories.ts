import { z } from "zod";
import { OUTPUT_SCHEMAS } from "./output-schemas.js";
import { formatCategories } from "./format.js";
import type { RegisterableTool, ToolDeps } from "./types.js";

const inputSchema = {
  parent_id: z
    .number()
    .int()
    .optional()
    .describe(
      "Parent category id. Omit to list top-level categories. Pass an id from a previous result to drill down."
    ),
};

export function createListCategoriesTool(deps: ToolDeps): RegisterableTool {
  const name = "list_categories";
  return {
    name,
    register(server, errorWrap) {
      return server.registerTool(
        name,
        {
          title: "List Alza categories",
          description:
            "Browse the Alza category tree one level at a time. Useful for narrowing a product search — find the right category id, then pass it to `search_products` as `category_id`. Without arguments, returns top-level categories.",
          inputSchema,
          outputSchema: OUTPUT_SCHEMAS["list_categories"],
          annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        },
        async (args) =>
          errorWrap(name, async () => {
            const categories = await deps.catalog.listCategories(args.parent_id);
            return {
              content: [{ type: "text", text: formatCategories(categories) }],
              structuredContent: { categories },
            };
          })
      );
    },
  };
}
