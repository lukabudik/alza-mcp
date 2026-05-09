import { z } from "zod";

/**
 * MCP prompt: /find-product
 * A guided template for shopping with the Alza MCP.
 */
export const findProductPrompt = {
  name: "find-product",
  config: {
    title: "Find a product on Alza",
    description:
      "Guided shopping helper — describe what you're looking for and the agent will search, compare, and recommend.",
    argsSchema: {
      need: z
        .string()
        .describe("What the user is looking for (e.g. 'a laptop for university, around 25000 CZK, light and quiet')."),
      budget: z
        .string()
        .optional()
        .describe("Optional explicit budget, e.g. '20000 CZK' or '500 EUR'."),
    },
  },
  handler: (args: { need: string; budget?: string }) => {
    const budgetLine = args.budget ? `Budget: ${args.budget}.` : "Budget: not specified — ask the user if relevant.";
    const text = [
      `The user is shopping on Alza.cz and described their need as:`,
      ``,
      `> ${args.need}`,
      ``,
      budgetLine,
      ``,
      `Help them find the right product:`,
      `1. Use \`search_products\` to find candidates. If the need is vague, ask one clarifying question first.`,
      `2. If results are too broad, refine using \`list_categories\` to find a relevant category id and search again.`,
      `3. Pick 2–4 strong candidates and call \`get_product\` for each to compare specs and price.`,
      `4. For the top 1–2 candidates, call \`get_product_reviews\` to surface real-world feedback.`,
      `5. Recommend a clear top pick with one alternative, citing concrete reasons (price, specs, reviews).`,
      `6. If the user asks where to pick it up, call \`find_pickup_points\` with their postal code.`,
      ``,
      `Always include the canonical Alza URL for any product you recommend so the user can verify and buy.`,
    ].join("\n");
    return {
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text },
        },
      ],
    };
  },
};
