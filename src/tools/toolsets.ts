import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisterableTool, ToolResult } from "./types.js";

/**
 * Progressive tool disclosure (MCP client-best-practices S3; Anthropic's
 * "few thoughtful tools" guidance, S4/S5 in docs/mcp-best-practices-audit.md):
 * with 53 raw operations, listing everything on every `tools/list` call
 * front-loads an agent's context with dozens of tools it may never touch in
 * a given conversation. Instead, only `catalog` (product discovery) and
 * `auth` (the bootstrap/handshake tools every other flow needs first) are
 * enabled by default; everything else is registered but starts disabled —
 * discoverable via `list_toolsets` and turned on with `set_toolset` once the
 * conversation actually needs it. The SDK's `RegisteredTool.enable()`/
 * `.disable()` fire the standard `notifications/tools/list_changed`
 * notification, so clients that support it see the change live.
 *
 * Every one of the 53 tool names must appear in exactly one group below —
 * `registerToolsets` asserts this at startup so a newly added tool can never
 * be silently unreachable (AGENTS.md: never silently omit an operation).
 */
export interface ToolsetDef {
  id: string;
  title: string;
  description: string;
  defaultEnabled: boolean;
  tools: string[];
}

export const TOOLSET_DEFS: ToolsetDef[] = [
  {
    id: "catalog",
    title: "Catalog & discovery",
    description: "Search, product detail, reviews, categories, and AlzaShop pickup-point lookup. Read-only, no account needed.",
    defaultEnabled: true,
    tools: ["search_products", "get_product", "get_product_reviews", "find_pickup_points", "list_categories", "list_category_filters"],
  },
  {
    id: "auth",
    title: "Auth & bootstrap",
    description: "OAuth handshake, account status, and the one-time mutation-token issuer every other toolset's writes require. Enable this first if you need anything beyond catalog browsing.",
    defaultEnabled: true,
    tools: ["auth_discovery", "auth_start", "auth_exchange", "account_status", "prepare_mutation"],
  },
  {
    id: "basket_and_checkout",
    title: "Basket, delivery & checkout",
    description: "Add to cart, delivery/pickup-point selection, checkout preview, order placement (mobile and web-WCF paths), and order cancellation. Enable when the user wants to actually buy or cancel something.",
    defaultEnabled: false,
    tools: [
      "cart", "add_to_cart", "delivery_options", "select_pickup_point", "checkout_preview", "place_order",
      "web_add_to_cart", "web_cart", "web_pickup_places", "web_place_order", "cancel_order", "mutate_list",
    ],
  },
  {
    id: "account_management",
    title: "Account & profile management",
    description: "Profile, contacts, addresses, registration, and credential/identity changes (password, 2FA, phone, email, account deletion). Enable for account-settings tasks.",
    defaultEnabled: false,
    tools: [
      "profile", "contacts", "register", "address_upsert", "address_delete", "address_search",
      "change_password", "two_factor_set", "phone_change", "email_change", "delete_account", "gdpr_info",
    ],
  },
  {
    id: "orders_and_payments",
    title: "Orders & payments",
    description: "Reading past orders, payment methods, after-order payment execution, warranty claims, and invoice documents. Enable for post-purchase / order-history tasks.",
    defaultEnabled: false,
    tools: [
      "payment_methods", "after_order_payments", "pay_after_order", "web_pay_after_order",
      "order", "order_search", "order_archive", "order_document", "claim_detail",
    ],
  },
  {
    id: "reviews_and_subscriptions",
    title: "Reviews, complaints, subscriptions & attachments",
    description: "Submitting reviews, listing complaints, AlzaSubscription management, attachment uploads, and EAN product lookup.",
    defaultEnabled: false,
    tools: [
      "review_submit", "complaint_claims", "subscription_overview", "subscription_activate",
      "subscription_update_installment", "upload_attachment", "product_by_ean",
    ],
  },
  {
    id: "chat",
    title: "Alza chat assistant",
    description: "Alza's own in-app chatbot navigation and message sending. Narrow, rarely needed outside a chat-support task.",
    defaultEnabled: false,
    tools: ["chat_navigation", "chat_send"],
  },
  {
    id: "advanced_raw",
    title: "Raw mobile-API escape hatch",
    description: "`mobile_read`: untyped read access to any mobile-API operation without a dedicated tool. Enable only when a typed tool genuinely doesn't cover what's needed.",
    defaultEnabled: false,
    tools: ["mobile_read"],
  },
];

export function registerToolsets(
  server: McpServer,
  errorWrap: (name: string, fn: () => Promise<ToolResult>) => Promise<ToolResult>,
  allTools: RegisterableTool[]
): void {
  const groupByTool = new Map<string, ToolsetDef>();
  for (const def of TOOLSET_DEFS) {
    for (const name of def.tools) {
      if (groupByTool.has(name)) {
        throw new Error(`toolset config error: "${name}" appears in both "${groupByTool.get(name)!.id}" and "${def.id}"`);
      }
      groupByTool.set(name, def);
    }
  }
  const allNames = new Set(allTools.map((t) => t.name));
  for (const name of allNames) {
    if (!groupByTool.has(name)) throw new Error(`toolset config error: "${name}" is registered but not assigned to any toolset`);
  }
  for (const name of groupByTool.keys()) {
    if (!allNames.has(name)) throw new Error(`toolset config error: "${name}" is assigned to a toolset but never registered`);
  }

  const registered = new Map<string, RegisteredTool>();
  for (const tool of allTools) {
    registered.set(tool.name, tool.register(server, errorWrap));
  }
  for (const [name, def] of groupByTool) {
    if (!def.defaultEnabled) registered.get(name)!.disable();
  }

  const toolsetIds = TOOLSET_DEFS.map((d) => d.id);

  server.registerTool(
    "list_toolsets",
    {
      title: "List available toolsets",
      description:
        "List every toolset this server groups its tools into: id, title, description, member tool names, and whether it's currently enabled. " +
        "Only `catalog` and `auth` are enabled by default to keep the visible tool list small — use `set_toolset` to turn on the group a task actually needs (e.g. `basket_and_checkout` before placing an order). " +
        "Call this first if you're unsure which toolset covers what you need. Read-only, no network call.",
      inputSchema: {},
      outputSchema: {
        toolsets: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            enabled: z.boolean(),
            tools: z.array(z.string()),
          })
        ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () =>
      errorWrap("list_toolsets", async () => {
        const toolsets = TOOLSET_DEFS.map((def) => ({
          id: def.id,
          title: def.title,
          description: def.description,
          enabled: def.tools.every((name) => registered.get(name)!.enabled),
          tools: def.tools,
        }));
        const lines = toolsets.map((t) => `- \`${t.id}\` (${t.enabled ? "enabled" : "disabled"}): ${t.title} — ${t.tools.join(", ")}`);
        return {
          content: [{ type: "text", text: `Toolsets:\n${lines.join("\n")}` }],
          structuredContent: { toolsets },
        };
      })
  );

  server.registerTool(
    "set_toolset",
    {
      title: "Enable or disable a toolset",
      description:
        "Enable or disable every tool in one toolset (or `all` for every toolset) at once, so only the tools relevant to the current task are visible. " +
        "Call `list_toolsets` first to see the available ids. Changing this fires the standard MCP tools-list-changed notification. " +
        "No Alza-side effect — this only changes which tools this MCP server currently exposes to you.",
      inputSchema: {
        id: z.enum(["all", ...toolsetIds] as [string, ...string[]]).describe("Toolset id from `list_toolsets`, or \"all\"."),
        enabled: z.boolean().describe("true to enable, false to disable."),
      },
      outputSchema: {
        id: z.string(),
        enabled: z.boolean(),
        tools_affected: z.array(z.string()),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args: { id: string; enabled: boolean }) =>
      errorWrap("set_toolset", async () => {
        const defs = args.id === "all" ? TOOLSET_DEFS : TOOLSET_DEFS.filter((d) => d.id === args.id);
        if (defs.length === 0) throw new Error(`Unknown toolset id: ${args.id}`);
        const affected: string[] = [];
        for (const def of defs) {
          for (const name of def.tools) {
            const t = registered.get(name)!;
            if (args.enabled) t.enable(); else t.disable();
            affected.push(name);
          }
        }
        return {
          content: [{ type: "text", text: `${args.enabled ? "Enabled" : "Disabled"} ${affected.length} tool(s) in "${args.id}".` }],
          structuredContent: { id: args.id, enabled: args.enabled, tools_affected: affected },
        };
      })
  );
}
