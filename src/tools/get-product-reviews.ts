import { z } from "zod";
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
      server.registerTool(
        name,
        {
          title: "Get product reviews (aggregate only in v0.1)",
          description:
            "Fetch the aggregate rating and total review count for a product (e.g. ★ 4.8 across 1284 reviews). NOTE: v0.1 returns aggregate values only — individual review bodies are loaded dynamically on Alza's reviews tab and are not yet scraped (planned for v0.2). The `reviews` array will be empty.",
          inputSchema,
          annotations: { readOnlyHint: true, idempotentHint: true },
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
