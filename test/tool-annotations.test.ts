import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";

/**
 * Annotation-contract test (audit docs/mcp-best-practices-audit.md F-05, N-2).
 * Connects an in-memory MCP client to the real server and asserts the
 * annotation matrix as served on the wire (no network — tools/list is local).
 */

async function listTools(): Promise<{ name: string; annotations: Record<string, unknown> | undefined }[]> {
  const built = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "annotation-contract", version: "0" });
  // Server first: client.connect() awaits the initialize response, which only
  // arrives once the server side is wired up (otherwise the request queues
  // forever in the linked pair).
  await built.server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    // Progressive disclosure (toolsets.ts): most tools start disabled to keep
    // the default tools/list small. Enable everything for these full-inventory checks.
    await client.callTool({ name: "set_toolset", arguments: { id: "all", enabled: true } });
    const res = await client.listTools();
    return res.tools.map((t) => ({
      name: t.name,
      annotations: t.annotations as Record<string, unknown> | undefined,
    }));
  } finally {
    await client.close();
    await built.close();
  }
}

const CATALOG = ["search_products", "get_product", "get_product_reviews", "find_pickup_points", "list_categories"];

const DESTRUCTIVE = new Set([
  "place_order",
  "web_place_order",
  "cancel_order",
  "register",
  "address_delete",
  "pay_after_order",
  "web_pay_after_order",
  "subscription_activate",
  "subscription_update_installment",
  "delete_account",
]);

const NO_OPEN_WORLD = new Set(["account_status", "prepare_mutation", "list_toolsets", "set_toolset"]);

describe("tool annotation contract", () => {
  it("serves exactly 56 tools with bare, snake_case names (54 domain tools + list_toolsets + set_toolset, all toolsets enabled)", async () => {
    const tools = await listTools();
    expect(tools).toHaveLength(56);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("marks all 5 catalog tools R+I+O, never destructive", async () => {
    const tools = await listTools();
    for (const name of CATALOG) {
      const a = tools.find((t) => t.name === name)?.annotations ?? {};
      expect(a.readOnlyHint).toBe(true);
      expect(a.idempotentHint).toBe(true);
      expect(a.openWorldHint).toBe(true);
      expect(a.destructiveHint).not.toBe(true);
    }
  });

  it("marks destructiveHint only on the 10 genuinely destructive tools", async () => {
    const tools = await listTools();
    const marked = new Set(tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name));
    expect([...marked].sort()).toEqual([...DESTRUCTIVE].sort());
  });

  it("leaves openWorldHint false only on the 4 no-network tools", async () => {
    const tools = await listTools();
    const noOpenWorld = new Set(
      tools.filter((t) => t.annotations?.openWorldHint === false).map((t) => t.name),
    );
    expect([...noOpenWorld].sort()).toEqual([...NO_OPEN_WORLD].sort());
    // account_status, prepare_mutation, and list_toolsets are read-only + no-network;
    // set_toolset is also no-network but mutates which tools are exposed (readOnlyHint false).
    for (const name of NO_OPEN_WORLD) {
      const a = tools.find((t) => t.name === name)?.annotations ?? {};
      expect(a.readOnlyHint).toBe(name !== "set_toolset");
    }
  });

  it("marks readOnlyHint on every tool except the 23 mutating ones", async () => {
    // The 25 mutating tools: OAuth handshake (auth_start/auth_exchange),
    // whitelisted low-risk mutate_list, cart/checkout/registration/payment
    // writes, the chat send, order cancellation (OR11), the A14–A18
    // account credential/identity mutations (change_password, two_factor_set,
    // phone_change, email_change, delete_account — all one-time-token gated,
    // 2026-09-22/23), and set_toolset (changes server-exposed capability,
    // even though it has no Alza-side effect).
    const mutating = new Set([
      "auth_start", "auth_exchange", "mutate_list", "add_to_cart",
      "select_pickup_point", "place_order", "web_add_to_cart", "chat_send",
      "register", "address_upsert", "address_delete", "pay_after_order",
      "web_pay_after_order", "review_submit", "subscription_activate",
      "subscription_update_installment", "upload_attachment", "web_place_order",
      "cancel_order",
      "change_password", "two_factor_set", "phone_change", "email_change", "delete_account",
      "set_toolset",
    ]);
    const tools = await listTools();
    for (const t of tools) {
      const a = t.annotations ?? {};
      if (mutating.has(t.name)) {
        expect(a.readOnlyHint).toBe(false);
      } else {
        expect(a.readOnlyHint).toBe(true);
      }
    }
  });
});
