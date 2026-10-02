import { z } from "zod";
import { OUTPUT_SCHEMAS } from "./output-schemas.js";
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
      "Restrict to specific pickup-point types. 'branch' = brick-and-mortar AlzaShop with staff (currently the only type that returns results). 'alzabox' = self-service parcel locker — accepted, but returns nothing: Alza's AlzaBox lookup API is checkout-cart-scoped (requires an orderId/groupId from an active cart), not a standalone geo endpoint. For real AlzaBox results, use `add_to_cart` + `delivery_options` + `web_pickup_places` instead — see that tool's description. Default: both."
    ),
};

export function createFindPickupPointsTool(deps: ToolDeps): RegisterableTool {
  const name = "find_pickup_points";
  return {
    name,
    register(server, errorWrap) {
      return server.registerTool(
        name,
        {
          title: "Find Alza showrooms",
          description:
            "Find Alza brick-and-mortar showrooms (AlzaShop) near a Czech/Slovak postal code: name, address, distance, and opening hours. " +
            "Use when the user wants to browse in person, get on-site advice, or find where an AlzaShop branch is. " +
            "Note: `types` accepts `alzabox`, but only `branch` results are returned here — Alza's AlzaBox lookup is checkout-cart-scoped (its API 400s without an orderId/groupId from an active cart), not a standalone postal-code search. " +
            "For real AlzaBox locker results: `add_to_cart` a product, call `delivery_options`, take the AlzaBox delivery option's `deliveryOption.href` query params (`orderId`, `groupId`), then call `web_pickup_places` with those plus `latitude`/`longitude` and `types: [1]` — results come back distance-sorted. " +
            "Also note: not every product is AlzaBox-eligible — Alza excludes large items (observed: 34\"+ monitors) from the AlzaBox network entirely, routing them to a small set of oversized-item pickup points instead; `delivery_options` reveals this per product. " +
            "Read-only. Example: `find_pickup_points({postal_code: '110 00', radius_km: 10})`",
          inputSchema,
          outputSchema: OUTPUT_SCHEMAS["find_pickup_points"],
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
