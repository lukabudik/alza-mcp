import { z } from "zod";
import { formatPickupPoints } from "./format.js";
import type { RegisterableTool, ToolDeps } from "./types.js";

const inputSchema = {
  postal_code: z
    .string()
    .min(3)
    .describe(
      "Czech (or other supported country) postal code. Examples: '110 00', '11000', '602 00'. Spaces are tolerated."
    ),
  radius_km: z
    .number()
    .positive()
    .max(100)
    .optional()
    .describe("Search radius in kilometres. Default 15 km."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum number of pickup points to return. Default 10."),
  types: z
    .array(z.enum(["alzabox", "branch"]))
    .optional()
    .describe(
      "Restrict to specific pickup-point types. 'alzabox' = self-service parcel locker (24/7). 'branch' = brick-and-mortar AlzaShop with staff. Default: both."
    ),
};

export function createFindPickupPointsTool(deps: ToolDeps): RegisterableTool {
  const name = "find_pickup_points";
  return {
    name,
    register(server, errorWrap) {
      server.registerTool(
        name,
        {
          title: "Find Alza showrooms",
          description:
            "Find Alza brick-and-mortar showrooms (AlzaShop) near a postal code. Use this when a user wants to know where they can collect a delivery, browse products in person, or get on-site advice. Note: AlzaBox parcel-locker discovery is planned for v0.2 — v0.1 returns staffed AlzaShop locations only.",
          inputSchema,
          annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        },
        async (args) =>
          errorWrap(name, async () => {
            const points = await deps.pickup.findPickupPoints({
              postalCode: args.postal_code,
              radiusKm: args.radius_km,
              limit: args.limit,
              types: args.types,
            });
            return {
              content: [{ type: "text", text: formatPickupPoints(points) }],
              structuredContent: { points },
            };
          })
      );
    },
  };
}
