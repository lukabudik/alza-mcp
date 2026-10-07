#!/usr/bin/env node
// Streamable HTTP checks against an alza-mcp-community `--http` server in another container.
// Runs in a client container with @modelcontextprotocol/sdk installed under /client.
//
// Env:
//   MCP_URL          default-mode endpoint, e.g. http://alza-http:3000/mcp
//   MCP_ACCOUNT_URL  endpoint of a server started with ALZA_HTTP_ENABLE_ACCOUNT=1 (optional)
//   MCP_LOOPBACK_URL endpoint of a server started WITHOUT --host (must be unreachable from here)
// Prints CHECK lines; exit 1 on any FAIL.
import { createRequire } from "node:module";
import http from "node:http";
const require = createRequire("/client/");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

let failed = false;
const check = (name, status, detail) => {
  if (status === "FAIL") failed = true;
  console.log(`CHECK ${name.padEnd(26)} ${status.padEnd(5)} ${detail}`);
};
const pass = (name, ok, detail) => check(name, ok ? "PASS" : "FAIL", detail);

async function connect(url, label) {
  const client = new Client({ name: `docker-harness-${label}`, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  return { client, transport };
}
const toolNames = async (c) => (await c.listTools()).tools.map((t) => t.name).sort();
const text = (r) => (r.content ?? []).map((c) => c.text ?? "").join(" ");

const url = process.env.MCP_URL;
const base = new URL(url);

// --- health + basic session
const health = await (await fetch(new URL("/healthz", base))).json().catch((e) => ({ error: e.message }));
pass("http-healthz", health.ok === true && health.transport === "streamable-http", JSON.stringify(health));

const A = await connect(url, "A");
const info = A.client.getServerVersion();
pass("http-initialize", !!A.transport.sessionId && info?.name === "alza-mcp-community",
  `server ${info?.name}@${info?.version}, session ${A.transport.sessionId?.slice(0, 8)}…, protocol ${A.transport.protocolVersion ?? "?"}`);
const toolsA0 = await toolNames(A.client);
pass("http-tools/list", toolsA0.includes("search_products") && toolsA0.includes("set_toolset"), `${toolsA0.length} tools: ${toolsA0.join(", ")}`);

// --- second session + per-session isolation of toolset state
const B = await connect(url, "B");
pass("http-two-sessions", B.transport.sessionId && B.transport.sessionId !== A.transport.sessionId,
  `A=${A.transport.sessionId?.slice(0, 8)}… B=${B.transport.sessionId?.slice(0, 8)}…`);
const h2 = await (await fetch(new URL("/healthz", base))).json();
pass("http-session-count", h2.sessions >= 2, `/healthz sessions=${h2.sessions}`);

const off = await A.client.callTool({ name: "set_toolset", arguments: { id: "catalog", enabled: false } });
const toolsA1 = await toolNames(A.client);
const toolsB1 = await toolNames(B.client);
pass("http-isolation-disable", !off.isError && !toolsA1.includes("search_products") && toolsB1.includes("search_products"),
  `A disabled catalog -> A has ${toolsA1.length} tools (search_products: ${toolsA1.includes("search_products")}), B has ${toolsB1.length} (search_products: ${toolsB1.includes("search_products")})`);
await A.client.callTool({ name: "set_toolset", arguments: { id: "catalog", enabled: true } });

const locked = await B.client.callTool({ name: "set_toolset", arguments: { id: "basket_and_checkout", enabled: true } });
pass("http-account-locked", locked.isError === true && /locked/i.test(text(locked)), text(locked).slice(0, 160));
const ts = await B.client.callTool({ name: "list_toolsets", arguments: {} });
const sets = ts.structuredContent?.toolsets ?? [];
// Policy: only anonymous read-only toolsets may stay unlocked on HTTP. Rather than hard-coding
// their ids, enable every unlocked toolset in session B and require all its tools to be readOnlyHint.
const unlocked = sets.filter((s) => !s.locked);
for (const s of unlocked) await B.client.callTool({ name: "set_toolset", arguments: { id: s.id, enabled: true } });
const listed = (await B.client.listTools()).tools;
const writable = listed.filter((t) => unlocked.some((s) => s.tools.includes(t.name)) && t.annotations?.readOnlyHint !== true).map((t) => t.name);
const mustLock = ["auth", "basket_and_checkout"].filter((id) => sets.some((s) => s.id === id));
pass("http-list_toolsets-locked", sets.length > 1 && unlocked.some((s) => s.id === "catalog") && writable.length === 0 && mustLock.every((id) => sets.find((s) => s.id === id).locked),
  `${sets.length - unlocked.length}/${sets.length} toolsets locked; unlocked: ${unlocked.map((s) => s.id).join(",")} (` +
  (writable.length ? `NOT read-only: ${writable.join(",")}` : `all ${listed.filter((t) => unlocked.some((s) => s.tools.includes(t.name))).length} of their tools are readOnlyHint`) + ")");
for (const s of unlocked) if (s.id !== "catalog") await B.client.callTool({ name: "set_toolset", arguments: { id: s.id, enabled: false } });

// --- protocol / security edges with raw fetch
const rpc = (body, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
const r404 = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-session-id": "00000000-0000-0000-0000-000000000000" });
pass("http-unknown-session", r404.status === 404, `unknown Mcp-Session-Id -> HTTP ${r404.status}`);
const r400 = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
pass("http-missing-session", r400.status === 400, `non-initialize without session -> HTTP ${r400.status}`);
const evil = await rpc(
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } },
  { origin: "http://evil.example" }
);
pass("http-origin-check", evil.status === 403, `Origin: http://evil.example -> HTTP ${evil.status}`);
// fetch() does not let us spoof Host, so use node:http (a DNS-rebinding page would arrive with this Host).
const rawStatus = (path, headers) =>
  new Promise((resolve) => {
    const req = http.request({ host: base.hostname, port: base.port, path, method: "GET", headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", (e) => resolve(e.message));
    req.end();
  });
const hostStatus = await rawStatus("/healthz", { host: "evil.example" });
const goodHostStatus = await rawStatus("/healthz", { host: base.host });
pass("http-host-check", hostStatus === 403 && goodHostStatus === 200, `Host: evil.example -> HTTP ${hostStatus}; Host: ${base.host} -> HTTP ${goodHostStatus}`);

// --- session termination
await A.transport.terminateSession();
const afterDel = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": A.transport.sessionId ?? "x", "mcp-protocol-version": "2025-06-18" });
const h3 = await (await fetch(new URL("/healthz", base))).json();
pass("http-delete-session", afterDel.status === 404 && h3.sessions === h2.sessions - 1, `after DELETE: reuse -> HTTP ${afterDel.status}, /healthz sessions=${h3.sessions}`);
await A.client.close().catch(() => {});
await B.client.close().catch(() => {});

// --- account mode: two sessions, enable a toolset in one only
if (process.env.MCP_ACCOUNT_URL) {
  const X = await connect(process.env.MCP_ACCOUNT_URL, "X");
  const Y = await connect(process.env.MCP_ACCOUNT_URL, "Y");
  const x0 = await toolNames(X.client);
  const en = await X.client.callTool({ name: "set_toolset", arguments: { id: "basket_and_checkout", enabled: true } });
  const x1 = await toolNames(X.client);
  const y1 = await toolNames(Y.client);
  pass("http-account-isolation", !en.isError && x1.length > x0.length && y1.length === x0.length,
    `ALZA_HTTP_ENABLE_ACCOUNT=1: X enabled basket_and_checkout -> X ${x0.length}->${x1.length} tools, Y stays ${y1.length}`);
  const sx = await X.client.callTool({ name: "account_status", arguments: {} });
  const sy = await Y.client.callTool({ name: "account_status", arguments: {} });
  const authX = sx.structuredContent?.authenticated;
  const authY = sy.structuredContent?.authenticated;
  pass("http-account-no-tokenfile", authX === false && authY === false, `account_status authenticated: X=${authX} Y=${authY} (no token file on HTTP)`);
  await X.client.close().catch(() => {});
  await Y.client.close().catch(() => {});
}

// --- default bind is loopback only
if (process.env.MCP_LOOPBACK_URL) {
  const r = await fetch(new URL("/healthz", process.env.MCP_LOOPBACK_URL)).then(
    (x) => `HTTP ${x.status}`,
    (e) => `refused (${e.cause?.code ?? e.message})`
  );
  pass("http-default-loopback", r.startsWith("refused"), `server started without --host, reached from another container: ${r}`);
}

process.exit(failed ? 1 : 0);
