#!/usr/bin/env node
// Dependency-free MCP stdio smoke client (raw newline-delimited JSON-RPC).
//
// Usage: node mcp-stdio-smoke.mjs [--live] [--timeout-ms N] -- <command> [args...]
//
// Spawns <command>, sends initialize -> notifications/initialized -> tools/list,
// and prints one JSON summary line prefixed with "SMOKE_RESULT ". With --live it
// also performs exactly one polite `search_products` call (limit 3) and reports
// whatever comes back (success, isError, or timeout) without failing the run.
// Exit code: 0 when initialize + tools/list succeeded, 1 otherwise.
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 0 || sep === argv.length - 1) {
  console.error("usage: mcp-stdio-smoke.mjs [--live] [--timeout-ms N] -- <command> [args...]");
  process.exit(2);
}
const opts = argv.slice(0, sep);
const [cmd, ...cmdArgs] = argv.slice(sep + 1);
const live = opts.includes("--live");
const tIdx = opts.indexOf("--timeout-ms");
const timeoutMs = tIdx >= 0 ? Number(opts[tIdx + 1]) : 180_000;
const liveQuery = process.env.SMOKE_QUERY ?? "usb c kabel";

const child = spawn(cmd, cmdArgs, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
let stderr = "";
child.stderr.on("data", (c) => {
  stderr += c.toString();
  if (process.env.SMOKE_VERBOSE) process.stderr.write(c);
});

const pending = new Map();
let buf = "";
const notifications = [];
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // a stray non-JSON line on stdout would itself be a bug; tools/list will then time out
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    } else if (msg.method) {
      notifications.push(msg.method);
    }
  }
});

let nextId = 1;
function request(method, params, ms = 60_000) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after ${ms}ms`));
    }, ms);
    pending.set(id, {
      resolve: (m) => {
        clearTimeout(timer);
        resolve(m);
      },
    });
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
const result = { command: [cmd, ...cmdArgs].join(" "), ok: false };
const hardTimer = setTimeout(() => {
  result.error = `overall timeout ${timeoutMs}ms`;
  finish(1);
}, timeoutMs);

function finish(code) {
  clearTimeout(hardTimer);
  result.notifications = [...new Set(notifications)];
  const lines = stderr.split("\n").filter(Boolean);
  result.stderrTail = (result.ok ? lines.filter((l) => /cf-transport|chromium|ready|error|warn|fatal/i.test(l)) : lines)
    .slice(-15)
    .map((l) => l.slice(0, 300));
  console.log("SMOKE_RESULT " + JSON.stringify(result));
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(code), 300);
}

child.on("error", (err) => {
  result.error = `spawn failed: ${err.message}`;
  finish(1);
});

(async () => {
  try {
    // npx may need to install the package first, so allow a generous first response.
    const init = await Promise.race([
      request(
        "initialize",
        {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "alza-mcp-community-docker-smoke", version: "1.0.0" },
        },
        timeoutMs - 5_000
      ),
      exited.then((e) => {
        throw new Error(`server exited before initialize (code=${e.code} signal=${e.signal})`);
      }),
    ]);
    if (init.error) throw new Error(`initialize error: ${JSON.stringify(init.error)}`);
    result.serverInfo = init.result.serverInfo;
    result.protocolVersion = init.result.protocolVersion;
    result.capabilities = Object.keys(init.result.capabilities ?? {});
    notify("notifications/initialized", {});

    const list = await request("tools/list", {});
    if (list.error) throw new Error(`tools/list error: ${JSON.stringify(list.error)}`);
    const names = list.result.tools.map((t) => t.name);
    result.toolCount = names.length;
    result.tools = names;
    for (const required of ["search_products", "list_toolsets", "set_toolset"]) {
      if (!names.includes(required)) throw new Error(`tools/list is missing ${required}`);
    }
    result.ok = true;

    if (live) {
      const started = Date.now();
      try {
        const call = await request(
          "tools/call",
          { name: "search_products", arguments: { query: liveQuery, limit: 3 } },
          Math.max(30_000, timeoutMs - 30_000)
        );
        const r = call.result ?? {};
        const text = (r.content ?? []).map((c) => c.text ?? "").join("\n");
        const products = r.structuredContent?.products ?? r.structuredContent?.items;
        result.live = {
          query: liveQuery,
          ms: Date.now() - started,
          isError: !!r.isError || !!call.error,
          productCount: Array.isArray(products) ? products.length : undefined,
          firstProductName: Array.isArray(products) && products[0] ? products[0].name ?? products[0].title : undefined,
          textHead: (call.error ? JSON.stringify(call.error) : text).slice(0, 400),
        };
      } catch (err) {
        result.live = { query: liveQuery, ms: Date.now() - started, isError: true, textHead: String(err.message) };
      }
    }
    finish(0);
  } catch (err) {
    result.error = err.message;
    finish(1);
  }
})();
