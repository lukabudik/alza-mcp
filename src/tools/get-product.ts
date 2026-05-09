import { z } from "zod";
import { formatProduct } from "./format.js";
import type { RegisterableTool, ToolDeps } from "./types.js";

const inputSchema = {
  code: z
    .string()
    .min(1)
    .describe(
      "Alza product code, e.g. 'WEXOA002B0'. This is the canonical identifier returned by `search_products` (the `code` field). Not the numeric id."
    ),
};

export function createGetProductTool(deps: ToolDeps): RegisterableTool {
  const name = "get_product";
  return {
    name,
    register(server, errorWrap) {
      server.registerTool(
        name,
        {
          title: "Get full product details",
          description:
            "Fetch complete details for a single product by its Alza code: price, current availability, full specs, brand, category, and image. Use this after `search_products` to dig into a specific result.",
          inputSchema,
          annotations: { readOnlyHint: true, idempotentHint: true },
        },
        async (args) =>
          errorWrap(name, async () => {
            const product = await deps.catalog.getProduct(args.code);
            return {
              content: [{ type: "text", text: formatProduct(product) }],
              structuredContent: { product: product as unknown as Record<string, unknown> },
            };
          })
      );
    },
  };
}
