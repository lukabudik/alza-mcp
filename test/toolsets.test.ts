import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { TOOLSET_DEFS } from "../src/tools/toolsets.js";

process.env.ALZA_TOKEN_FILE = "none";

async function clientAndServer() {
  const built = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "toolsets-test", version: "0" });
  await built.server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, built };
}

describe("progressive tool disclosure (toolsets)", () => {
  it("every one of the 54 domain tools is assigned to exactly one toolset", () => {
    const seen = new Map<string, string>();
    for (const def of TOOLSET_DEFS) {
      for (const name of def.tools) {
        expect(seen.has(name), `"${name}" assigned to both "${seen.get(name)}" and "${def.id}"`).toBe(false);
        seen.set(name, def.id);
      }
    }
    expect(seen.size).toBe(54);
  });

  it("exposes only the catalog + auth toolsets (10 tools) plus list_toolsets/set_toolset by default", async () => {
    const { client, built } = await clientAndServer();
    try {
      const res = await client.listTools();
      const names = res.tools.map((t) => t.name).sort();
      const expected = [
        ...TOOLSET_DEFS.find((d) => d.id === "catalog")!.tools,
        ...TOOLSET_DEFS.find((d) => d.id === "auth")!.tools,
        "list_toolsets",
        "set_toolset",
      ].sort();
      expect(names).toEqual(expected);
    } finally {
      await client.close();
      await built.close();
    }
  });

  it("list_toolsets reports every group with its enabled state and member tools", async () => {
    const { client, built } = await clientAndServer();
    try {
      const res = await client.callTool({ name: "list_toolsets", arguments: {} });
      const sc = res.structuredContent as { toolsets: { id: string; enabled: boolean; tools: string[] }[] };
      expect(sc.toolsets).toHaveLength(TOOLSET_DEFS.length);
      const byId = new Map(sc.toolsets.map((t) => [t.id, t]));
      expect(byId.get("catalog")?.enabled).toBe(true);
      expect(byId.get("auth")?.enabled).toBe(true);
      expect(byId.get("basket_and_checkout")?.enabled).toBe(false);
      expect(byId.get("basket_and_checkout")?.tools).toContain("add_to_cart");
    } finally {
      await client.close();
      await built.close();
    }
  });

  it("set_toolset enables a disabled group, and calling a newly-enabled tool then works", async () => {
    const { client, built } = await clientAndServer();
    try {
      const disabledRes = await client.callTool({ name: "add_to_cart", arguments: { code: "X" } });
      expect(disabledRes.isError).toBeTruthy();

      const enableRes = await client.callTool({ name: "set_toolset", arguments: { id: "basket_and_checkout", enabled: true } });
      const enableSc = enableRes.structuredContent as { id: string; enabled: boolean; tools_affected: string[] };
      expect(enableSc.id).toBe("basket_and_checkout");
      expect(enableSc.enabled).toBe(true);
      expect(enableSc.tools_affected).toContain("add_to_cart");

      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("add_to_cart");
      expect(names).toContain("cancel_order");

      // now disable it again
      await client.callTool({ name: "set_toolset", arguments: { id: "basket_and_checkout", enabled: false } });
      const namesAfter = (await client.listTools()).tools.map((t) => t.name);
      expect(namesAfter).not.toContain("add_to_cart");
    } finally {
      await client.close();
      await built.close();
    }
  });

  it("set_toolset('all', true) enables every tool; ('all', false) re-disables the non-default ones", async () => {
    const { client, built } = await clientAndServer();
    try {
      await client.callTool({ name: "set_toolset", arguments: { id: "all", enabled: true } });
      expect((await client.listTools()).tools).toHaveLength(56);

      await client.callTool({ name: "set_toolset", arguments: { id: "all", enabled: false } });
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      // list_toolsets/set_toolset are registered outside any toolset, so "all" doesn't touch them.
      expect(names).toEqual(["list_toolsets", "set_toolset"]);
    } finally {
      await client.close();
      await built.close();
    }
  });

  it("rejects an unknown toolset id", async () => {
    const { client, built } = await clientAndServer();
    try {
      const res = await client.callTool({ name: "set_toolset", arguments: { id: "not_a_real_toolset", enabled: true } });
      expect(res.isError).toBeTruthy();
    } catch (e) {
      // Zod enum validation may reject at the protocol layer instead.
      expect(String(e)).toMatch(/not_a_real_toolset|Invalid/i);
    } finally {
      await client.close();
      await built.close();
    }
  });
});
