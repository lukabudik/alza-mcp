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
          title: "Get product reviews",
          description:
            "Fetch user reviews and aggregate rating for a product. Returns the average rating, total review count, and the most recent N individual reviews (author, date, rating, text). Useful for buying decisions.",
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
