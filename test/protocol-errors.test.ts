import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { informationalOutput, replyForTransportError } from "../src/cli.js";
import { parseCliConfig, startHttpServer, type RunningHttpServer } from "../src/http.js";
import { AlzaError, ConfigurationError, NotFoundError, UserError, truncateInput } from "../src/infra/errors.js";
import { resolveLocale } from "../src/infra/locale.js";
import { apiHttpFailure } from "../src/infra/mobile-api.js";
import { Pickup } from "../src/domain/pickup.js";
import { createProductResource } from "../src/resources/product.js";
import { buildServer, friendlyError } from "../src/server.js";
import { TOOLSET_DEFS } from "../src/tools/toolsets.js";

process.env.ALZA_TOKEN_FILE = "none";

async function connected() {
  const built = buildServer();
  const [s, c] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "protocol-errors", version: "0" });
  await built.server.connect(s);
  await client.connect(c);
  return { client, built };
}
const text = (res: unknown) => ((res as { content: { text: string }[] }).content[0]?.text) ?? "";

describe("report_issue hint is only for unexpected failures", () => {
  it("a wrong confirmation token is a user error without the hint", async () => {
    const { client, built } = await connected();
    try {
      await client.callTool({ name: "set_toolset", arguments: { id: "basket_and_checkout", enabled: true } });
      const res = await client.callTool({ name: "mutate_list", arguments: { action: "create", confirmation_token: "a".repeat(48), payload: { name: "x" } } });
      expect(res.isError).toBe(true);
      expect(text(res)).toMatch(/Invalid or expired/);
      expect(text(res)).not.toMatch(/report_issue/);
    } finally {
      await client.close();
      await built.close();
    }
  });

  it("maps 401/403 to sign-in / user_id guidance (user errors) and keeps other statuses generic", () => {
    const e401 = apiHttpFailure("GET", "https://www.alza.cz/api/users/5/orders?visitor=abc", 401, "Authorization has been denied");
    expect(e401).toBeInstanceOf(UserError);
    expect(e401.message).toMatch(/auth_start/);
    const e403 = apiHttpFailure("GET", "https://www.alza.cz/api/users/5/gdpr", 403, { message: "forbidden" });
    expect(e403).toBeInstanceOf(UserError);
    expect(e403.message).toMatch(/user_id/);
    const e500 = apiHttpFailure("GET", "https://www.alza.cz/api/x?visitor=abc", 500, "boom");
    expect(e500).not.toBeInstanceOf(UserError);
  });

  it("an unknown postal code is a user error and a geocoder outage is not blamed on Alza", async () => {
    vi.resetModules();
    vi.doMock("undici", () => ({ fetch: async () => ({ ok: true, json: async () => [] }) }));
    const { Pickup: P } = await import("../src/domain/pickup.js");
    const p = new P(resolveLocale("https://www.alza.cz"), { getJson: async () => ({}) });
    const err = await p.findPickupPoints({ postalCode: "99999" }).catch((e: unknown) => e);
    expect((err as Error).name).toBe("UserError");
    expect((err as Error).message).toMatch(/Nominatim/);

    vi.resetModules();
    vi.doMock("undici", () => ({ fetch: async () => ({ ok: false, status: 503 }) }));
    const { Pickup: P2 } = await import("../src/domain/pickup.js");
    const p2 = new P2(resolveLocale("https://www.alza.cz"), { getJson: async () => ({}) });
    const err2 = await p2.findPickupPoints({ postalCode: "11000" }).catch((e: unknown) => e);
    expect((err2 as Error).name).toBe("AlzaError");
    expect(friendlyError(err2)).not.toMatch(/Alza upstream/);
    vi.doUnmock("undici");
    void Pickup;
  });
});

describe("error contract", () => {
  it("product resource not-found is -32002, with a truncated echo", async () => {
    const catalog = { getProduct: async (code: string) => { throw new NotFoundError(`product ${code}`); } };
    const res = createProductResource(catalog as never);
    const err = await res.handler(new URL(`alza://product/${"X".repeat(2000)}`)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(-32002);
    expect((err as Error).message.length).toBeLessThan(400);
  });

  it("zod validation errors are short path: message text", async () => {
    const { client, built } = await connected();
    try {
      const res = await client.callTool({ name: "set_toolset", arguments: { id: "nope", enabled: true } });
      expect(res.isError).toBe(true);
      const t = text(res);
      expect(t).toMatch(/^Invalid arguments for set_toolset — id: invalid value "nope"/);
      expect(t).not.toContain("[\n");
      expect(t.length).toBeLessThan(300);
    } finally {
      await client.close();
      await built.close();
    }
  });

  it("truncateInput bounds echoed text", () => {
    expect(truncateInput("a".repeat(2000)).length).toBeLessThan(100);
    expect(new NotFoundError("product " + "Z".repeat(2000)).message.length).toBeLessThan(200);
  });

  it("HTML bodies are summarised and URLs lose their query string (visitor id)", () => {
    const err = apiHttpFailure("GET", "https://webapi.alza.cz/api/whisper?country=CZ&visitor=123e4567-e89b-12d3-a456-426614174000", 403, "<!DOCTYPE html><html><script>var getData = 1</script></html>");
    expect(err.message).toMatch(/Cloudflare/);
    expect(err.message).not.toMatch(/DOCTYPE|visitor|123e4567|<script/);
  });
});

describe("tools/call robustness", () => {
  it("accepts a missing `arguments` for no-arg tools", async () => {
    const { client, built } = await connected();
    try {
      const res = await client.request({ method: "tools/call", params: { name: "list_toolsets" } }, (await import("@modelcontextprotocol/sdk/types.js")).CallToolResultSchema);
      expect(res.isError).toBeFalsy();
      expect(JSON.stringify(res.content)).toMatch(/Toolsets/);
    } finally {
      await client.close();
      await built.close();
    }
  });

  it("every published schema pattern compiles in unicode mode (upload_attachment)", async () => {
    const { client, built } = await connected();
    try {
      await client.callTool({ name: "set_toolset", arguments: { id: "all", enabled: true } });
      const { tools } = await client.listTools();
      expect(tools.some((t) => t.name === "upload_attachment")).toBe(true);
      const patterns: string[] = [];
      const walk = (n: unknown) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") {
          for (const [k, v] of Object.entries(n)) {
            if (k === "pattern" && typeof v === "string") patterns.push(v);
            else walk(v);
          }
        }
      };
      walk(tools.map((t) => t.inputSchema));
      for (const p of patterns) expect(() => new RegExp(p, "u"), p).not.toThrow();
    } finally {
      await client.close();
      await built.close();
    }
  });
});

describe("CLI", () => {
  it("handles --help / --version / -v before parsing config", () => {
    expect(informationalOutput(["--help"])).toMatch(/Usage: alza-mcp-community/);
    expect(informationalOutput(["-h"])).toMatch(/Usage/);
    expect(informationalOutput(["--version"])).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect(informationalOutput(["-v"])).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect(informationalOutput(["--http"])).toBeUndefined();
  });

  it("argument errors are ConfigurationErrors (one-line, no stack)", () => {
    expect(() => parseCliConfig(["--bogus"], {})).toThrow(ConfigurationError);
    expect(() => parseCliConfig(["--http", "--port", "abc"], {})).toThrow(ConfigurationError);
    expect(() => parseCliConfig([], { ALZA_TRANSPORT: "carrier-pigeon" })).toThrow(ConfigurationError);
  });

  it("an empty ALZA_BASE_URL is unset and URL userinfo is never echoed", () => {
    expect(parseCliConfig(["--http"], { ALZA_BASE_URL: "" }).http.baseUrl).toBeUndefined();
    let message = "";
    try { resolveLocale("https://user:s3cret@www.example.com/?q=1"); } catch (e) { message = (e as Error).message; expect(e).toBeInstanceOf(ConfigurationError); }
    expect(message).toMatch(/Unsupported ALZA_BASE_URL/);
    expect(message).not.toMatch(/s3cret|user:/);
  });
});

describe("stdio transport errors", () => {
  it("replies to malformed JSON with -32700 and invalid JSON-RPC with -32600 (id null)", () => {
    const parse = JSON.parse(replyForTransportError(new SyntaxError("x"))!);
    expect(parse).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
    const zodLike = Object.assign(new Error("bad"), { name: "ZodError" });
    expect(JSON.parse(replyForTransportError(zodLike)!)).toMatchObject({ id: null, error: { code: -32600 } });
    expect(replyForTransportError(new Error("socket closed"))).toBeUndefined();
  });
});

describe("HTTP status codes", () => {
  let server: RunningHttpServer | undefined;
  afterEach(async () => { await server?.close(); server = undefined; });

  const raw = (port: number, method: string, body?: string | Buffer) =>
    new Promise<{ status: number; body: string; allow?: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, method, path: "/mcp", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b, allow: res.headers.allow as string | undefined }));
      });
      req.on("error", (e) => { if ((e as NodeJS.ErrnoException).code === "EPIPE" || (e as NodeJS.ErrnoException).code === "ECONNRESET") resolve({ status: 413, body: "" }); else reject(e); });
      req.end(body);
    });
  const port = () => Number(new URL(server!.url).port);

  it("oversized body is 413, PUT is 405, a batched initialize says batches are unsupported", async () => {
    server = await startHttpServer({ port: 0 });
    const big = await raw(port(), "POST", Buffer.alloc(5 * 1024 * 1024, 0x20));
    expect(big.status).toBe(413);
    const put = await raw(port(), "PUT");
    expect(put.status).toBe(405);
    expect(put.allow).toMatch(/POST/);
    const batch = await raw(port(), "POST", JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]));
    expect(batch.status).toBe(400);
    expect(batch.body).toMatch(/batches are not supported/);
    expect(TOOLSET_DEFS.length).toBeGreaterThan(0);
  });
});
