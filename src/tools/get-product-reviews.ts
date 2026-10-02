import { z } from "zod";
import { OUTPUT_SCHEMAS } from "./output-schemas.js";
import { formatReviews } from "./format.js";
import type { RegisterableTool, ToolDeps } from "./types.js";

const inputSchema = {
  code: z
    .string()
    .min(1)
    .describe("Alza product code, e.g. 'WEXOA002B0'. Same as the `code` from `search_products`."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum number of individual reviews to include. Default 10, max 50."),
};

export function createGetProductReviewsTool(deps: ToolDeps): RegisterableTool {
  const name = "get_product_reviews";
  return {
    name,
    register(server, errorWrap) {
      return server.registerTool(
        name,
        {
          title: "Get product reviews",
          description:
            "Fetch reviews for a single product by its Alza code: the aggregate rating and review count plus up to `limit` individual reviews (author, date, rating, body) scraped from the product's reviews section. " +
            "Use after `get_product` when the user wants real-world feedback before deciding. " +
            "If the reviews section is not rendered on the page you receive the aggregate only (empty `reviews` array) — in that case rely on the rating/count. " +
            "Do not use for the aggregate rating alone when you already have it from `search_products`/`get_product`. Read-only.",
          inputSchema,
          outputSchema: OUTPUT_SCHEMAS["get_product_reviews"],
          annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        },
        async (args) =>
          errorWrap(name, async () => {
            const reviews = await deps.reviews.getProductReviews(args.code, args.limit ?? 10);
            return {
              content: [{ type: "text", text: formatReviews(reviews) }],
              structuredContent: {
                code: reviews.code,
                ratingAverage: reviews.ratingAverage,
                reviewCount: reviews.reviewCount,
                reviews: reviews.reviews,
              },
            };
          })
      );
    },
  };
}
