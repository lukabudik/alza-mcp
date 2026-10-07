#!/usr/bin/env tsx
/**
 * Agent-driven MCP eval harness: runs scripted tool-use scenarios against the
 * real server over an in-memory transport (same registration path as stdio)
 * and records per-scenario check results.
 *
 *     npm run eval
 *
 * Writes docs/live-evidence/eval-<date>.json. Scenarios are non-mutating:
 * catalog reads, discovery, status, one account-stack read; no cart/order
 * mutations are ever executed here. Catalog/account scenarios require network
 * access to alza.cz; run them where that is permitted.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "../src/server.js";
import { OUTPUT_SCHEMAS } from "../src/tools/output-schemas.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Check {
  check: string;
  ok: boolean;
  observed?: string;
}

interface ScenarioResult {
  name: string;
  live: boolean;
  status: "passed" | "failed";
  durationMs: number;
  checks: Check[];
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const evidenceDir = resolve(root, "docs/live-evidence");
const today = new Date().toISOString().slice(0, 10);
const outPath = resolve(evidenceDir, `eval-${today}.json`);

const CANONICAL_ORDER = [
  // catalog (server.ts order)
  "search_products", "get_product", "compare_products", "get_product_reviews", "recommend_alternatives", "find_pickup_points", "list_category_filters", "list_categories", "get_deals", "autocomplete",
  // account.ts order
  "auth_discovery", "auth_start", "auth_exchange", "mobile_read", "prepare_mutation", "mutate_list",
  "account_status", "cart", "add_to_cart", "delivery_options", "select_pickup_point",
  "checkout_preview", "place_order", "web_pickup_places", "web_add_to_cart", "web_cart",
  "chat_navigation", "chat_send",
  // advanced.ts order
  "profile", "contacts", "register", "address_upsert", "address_delete", "address_search",
  "payment_methods", "after_order_payments", "pay_after_order", "web_pay_after_order", "order",
  "order_search", "order_archive", "product_by_ean", "gdpr_info", "claim_detail", "order_document",
  "change_password", "two_factor_set", "phone_change", "email_change", "delete_account",
  "review_submit", "complaint_claims", "subscription_overview", "subscription_activate",
  "subscription_update_installment", "upload_attachment", "web_place_order", "cancel_order",
  // watchdog.ts order
  "watchdog_list", "watchdog_set", "watchdog_delete",
  // pc-builder.ts (issue #15)
  "pc_build_check", "pc_build_suggest",
  // toolsets.ts meta-tools (registered after every domain tool)
  "list_toolsets", "set_toolset",
  // report-issue.ts (registered after the toolsets, always available)
  "report_issue",
];

type NamedTool = Tool & { outputSchema?: Record<string, unknown> };

interface Session {
  client: Client;
  tools: NamedTool[];
  protocolVersion: string;
}

async function openSession(): Promise<Session> {
  const built = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "alza-eval", version: "0.3.0" });
  // SDK 1.29 Client has no public protocolVersion getter; the negotiated
  // version is delivered to transport.setProtocolVersion after initialize.
  let negotiated = "";
  (clientTransport as unknown as { setProtocolVersion?: (v: string) => void }).setProtocolVersion = (v) => {
    negotiated = v;
  };
  // Server-first connect (client-first deadlocks in the linked pair).
  await built.server.connect(serverTransport);
  await client.connect(clientTransport);
  // Progressive disclosure (src/tools/toolsets.ts): most tools start disabled
  // to keep the default tools/list small. This harness audits the full
  // registration surface, so enable everything first.
  await client.callTool({ name: "set_toolset", arguments: { id: "all", enabled: true } });
  const res = await client.listTools();
  const tools = res.tools as NamedTool[];
  await built.close();
  await client.close();
  return { client, tools, protocolVersion: negotiated || "unknown" };
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  // Reopen per call: the SDK Client is single-use across reconnects, so the
  // harness opens a fresh linked pair per scenario.
  const built = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "alza-eval", version: "0.3.0" });
  await built.server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    // See openSession(): enable every toolset so any named tool is callable.
    if (name !== "set_toolset" && name !== "list_toolsets") {
      await client.callTool({ name: "set_toolset", arguments: { id: "all", enabled: true } });
    }
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
    await built.close();
  }
}

const check = (checks: Check[], what: string, ok: boolean, observed?: string): boolean => {
  checks.push({ check: what, ok, observed });
  return ok;
};

async function scenario(name: string, live: boolean, fn: (c: Check[]) => Promise<void>): Promise<ScenarioResult> {
  const checks: Check[] = [];
  const t0 = Date.now();
  let status: "passed" | "failed" = "passed";
  try {
    await fn(checks);
  } catch (e) {
    checks.push({ check: "no exception", ok: false, observed: String((e as Error).message ?? e).slice(0, 200) });
    status = "failed";
  }
  if (checks.some((c) => !c.ok)) status = "failed";
  return { name, live, status, durationMs: Date.now() - t0, checks };
}

async function run(): Promise<void> {
  const scenarios: ScenarioResult[] = [];
  const session = await openSession();
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

  scenarios.push(await scenario("registration-surface", false, async (c) => {
    const tools = session.tools;
    check(c, "tool count is 66 (63 domain tools + list_toolsets + set_toolset + report_issue)", tools.length === 66, String(tools.length));
    check(c, "registration order is deterministic", JSON.stringify(tools.map((t) => t.name)) === JSON.stringify(CANONICAL_ORDER), JSON.stringify(tools.map((t) => t.name)));
    const missing = tools.filter((t) => !t.title || !t.description || t.description.length < 40);
    check(c, "every tool has a ≥40-char description and a title", missing.length === 0, missing.map((t) => t.name).join(","));
    const noOut = tools.filter((t) => !t.outputSchema || (t.outputSchema as Record<string, unknown>).type !== "object");
    check(c, "every tool publishes an object outputSchema", noOut.length === 0, noOut.map((t) => t.name).join(","));
    check(c, "outputSchema map covers all 63 domain-tool names", Object.keys(OUTPUT_SCHEMAS).length === 63, String(Object.keys(OUTPUT_SCHEMAS).length));
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    const destructive = tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name);
    const mutating = tools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name);
    check(c, "readOnlyHint true on exactly 39", readOnly.length === 39, String(readOnly.length));
    check(c, "destructiveHint true on exactly 10", destructive.length === 10, String(destructive.length));
    check(c, "readOnlyHint false (mutating) on exactly 27", mutating.length === 27, String(mutating.length));
  }));

  scenarios.push(await scenario("catalog-read", true, async (c) => {
    const call1 = await call("search_products", { query: "notebook", limit: 5 });
    const sc = call1.structuredContent as { query: string; total: number; pageSize: number; products: { code: string; name: string; price?: number; currency: string }[] };
    check(c, "isError false", Boolean(call1.isError) === false, String(call1.isError));
    check(c, "structuredContent present", Boolean(sc), "no structuredContent");
    if (!sc) return;
    check(c, "query echoed", sc.query === "notebook", String(sc.query));
    check(c, "limit respected (≤5 products)", sc.products.length <= 5, String(sc.products.length));
    const text = ((call1.content as { type: string; text: string }[])[0] ?? {}).text ?? "";
    const first = sc.products[0];
    if (!first) {
      // Upstream search can legitimately return 0 for a query; the tool is
      // still correct if it reports total honestly. Record and skip the
      // detail/reviews sub-checks rather than failing the harness run.
      check(c, "empty result is honestly reported (total echoed as 0)", sc.total === 0, `total=${sc.total}`);
      c.push({ check: "detail/reviews sub-checks skipped: upstream returned no products for the query", ok: true });
      return;
    }
    check(c, "≥1 product returned", sc.products.length >= 1, String(sc.products.length));
    check(c, "product has code+name+currency", Boolean(first.code && first.name && first.currency), `${first.code} ${first.name} ${first.currency}`);
    check(c, "text channel is human-readable (≥80 chars, names the first product)", text.length >= 80 && text.includes(first.name.slice(0, 20)), `${text.length} chars`);
    const call2 = await call("get_product", { code: first.code });
    const product = (call2.structuredContent as { product: { code: string; name: string; url: string } }).product;
    check(c, "get_product isError false", Boolean(call2.isError) === false, String(call2.isError));
    check(c, "get_product returns the requested code", Boolean(product && product.code === first.code), `${product?.code} vs ${first.code}`);
    check(c, "product has name+url", Boolean(product && product.name && product.url), `${product?.name} ${product?.url}`);
    const call3 = await call("get_product_reviews", { code: first.code });
    const sc3 = call3.structuredContent as { code: string; ratingAverage?: number; reviewCount?: number; reviews: unknown[] };
    check(c, "get_product_reviews isError false", Boolean(call3.isError) === false, String(call3.isError));
    check(c, "reviews is an array", Array.isArray(sc3?.reviews), String(sc3?.reviews?.length));
    check(c, "code echoed", sc3?.code === first.code, `${sc3?.code} vs ${first.code}`);
  }));

  scenarios.push(await scenario("auth-discovery", true, async (c) => {
    const call1 = await call("auth_discovery", {});
    const text = ((call1.content as { type: string; text: string }[])[0] ?? {}).text ?? "";
    if (call1.isError) {
      // The upstream authority may be unreachable/blocked from the running
      // environment; the eval then checks that the tool surfaces a graceful,
      // actionable error result rather than crashing.
      check(c, "blocked upstream → graceful error result mentioning HTTP", /HTTP \d+/.test(text) && text.length > 0 && !text.includes("at "), text.slice(0, 160));
    } else {
      const doc = call1.structuredContent as { issuer?: string; authorization_endpoint?: string };
      check(c, "OIDC issuer present", typeof doc.issuer === "string" && doc.issuer.length > 0, String(doc.issuer));
      check(c, "authorization_endpoint present", typeof doc.authorization_endpoint === "string" && doc.authorization_endpoint.length > 0, String(doc.authorization_endpoint));
    }
  }));

  scenarios.push(await scenario("account-status", false, async (c) => {
    const call1 = await call("account_status", {});
    const sc = call1.structuredContent as { authenticated: boolean; visitorId: string; apiBaseUrl: string };
    check(c, "isError false", Boolean(call1.isError) === false, String(call1.isError));
    check(c, "authenticated is a boolean", typeof sc.authenticated === "boolean", String(sc.authenticated));
    check(c, "visitorId is a string", typeof sc.visitorId === "string", String(sc.visitorId));
    check(c, "apiBaseUrl is an alza URL", /^https:\/\/.+alza/.test(sc.apiBaseUrl), sc.apiBaseUrl);
  }));

  scenarios.push(await scenario("account-read", true, async (c) => {
    // home_categories is deliberately not used as the scenario read: the
    // upstream endpoint requires pgri/ui query values (HTTP 400 without them,
    // observed 2026-09-13), so a standalone call is not reliable. user_data is
    // the canonical account-stack read.
    const call2 = await call("mobile_read", { operation: "user_data" });
    const authenticated = (await call("account_status", {})).structuredContent as { authenticated: boolean };
    if (authenticated.authenticated) {
      const sc2 = call2.structuredContent as Record<string, unknown>;
      check(c, "authenticated user_data isError false", Boolean(call2.isError) === false, String(call2.isError));
      check(c, "authenticated user_data err 0 or object", Boolean(sc2), JSON.stringify(sc2).slice(0, 80));
    } else {
      const text = ((call2.content as { type: string; text: string }[])[0] ?? {}).text ?? "";
      const sc2 = (call2.structuredContent ?? {}) as { user_id?: unknown };
      // Two upstream behaviours are both acceptable, as long as the agent can tell it
      // is not signed in: an IP-blocked read (HTTP 403 with an HTML body, observed
      // 2026-09-13) surfaces as an error result naming the HTTP status; an anonymous
      // read (HTTP 200, user_id -1, observed 2026-10-07 via the sidecar) carries the
      // "Not signed in" note.
      if (call2.isError) {
        check(c, "unauthenticated user_data error names the HTTP status", /HTTP \d+/.test(text) && !text.includes("at "), text.slice(0, 160));
      } else {
        check(c, "unauthenticated user_data returns the anonymous account (user_id -1)", sc2.user_id === -1, String(sc2.user_id));
        check(c, "anonymous user_data text says it is not signed in", text.startsWith("Not signed in"), text.slice(0, 160));
      }
    }
  }));

  scenarios.push(await scenario("input-validation-error-quality", false, async (c) => {
    const call1 = await call("get_product", { code: "" });
    const text = ((call1.content as { type: string; text: string }[])[0] ?? {}).text ?? "";
    check(c, "empty code rejected", Boolean(call1.isError) === true, String(call1.isError));
    check(c, "error mentions the offending parameter", /code/i.test(text), text.slice(0, 120));
  }));

  const failed = scenarios.filter((s) => s.status === "failed");
  const evidence = {
    generatedAt: new Date().toISOString(),
    package: "alza-mcp-community",
    serverVersion: pkg.version as string,
    protocolVersion: session.protocolVersion,
    transport: "in-memory",
    scenarioCount: scenarios.length,
    scenarios,
    summary: { total: scenarios.length, passed: scenarios.length - failed.length, failed: failed.length },
    notes: [
      "Non-mutating harness: catalog reads, auth_discovery, account_status, mobile_read; no cart/order mutations.",
      "Live scenarios hit alza.cz/identity.alza.cz; offline scenarios are deterministic.",
      "Per-check details in scenarios[].checks; observed values recorded for auditability.",
    ],
  };
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`[eval] ${evidence.summary.passed}/${evidence.summary.total} scenarios passed; evidence → ${outPath}`);
  for (const s of scenarios) {
    console.log(`  ${s.status === "passed" ? "✔" : "✖"} ${s.name} (${s.durationMs} ms)${s.status === "failed" ? `: ${s.checks.filter((x) => !x.ok).map((x) => x.check).join("; ")}` : ""}`);
  }
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error(String((e as Error).stack ?? e));
  process.exit(1);
});
