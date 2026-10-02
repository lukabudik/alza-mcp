#!/usr/bin/env node
// Smoke-test the AUTHENTICATED, READ-ONLY Alza mobile endpoints using the token
// stored by scripts/alza-auth-login.mjs.
//
// Scope is deliberately read-only. Mutating endpoints (alza_add_to_cart,
// alza_mutate_list, alza_select_pickup_point, alza_place_order) are NOT exercised
// here: this runs against production, where a mutation is a real cart change and
// an order is a real purchase. Cover those with mocks — see
// test/registration-contract.test.ts for the pattern.
//
//   node scripts/alza-auth-smoke.mjs
//   node scripts/alza-auth-smoke.mjs --json
//
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE_URL = (process.env.ALZA_API_BASE_URL ?? "https://www.alza.cz").replace(/\/$/, "");
const TOKEN_FILE = process.env.ALZA_TOKEN_FILE ?? join(homedir(), ".alza-mcp", "tokens.json");
const asJson = process.argv.includes("--json");

let store;
try {
  store = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
} catch {
  console.error(`No token store at ${TOKEN_FILE} — run: node scripts/alza-auth-login.mjs`);
  process.exit(1);
}
if (!store.access_token) {
  console.error("Token store has no access_token — re-run the login script.");
  process.exit(1);
}

const visitorId = store.visitor_id ?? process.env.ALZA_VISITOR_ID ?? randomUUID();

const headers = () => ({
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": "Alza/2026.15.0 (Android)",
  "accept-language": "cs-CZ,cs;q=0.9,en;q=0.8",
  "Balancer-Guid": visitorId,
  "x-correlation-id": randomUUID(),
  authorization: `Bearer ${store.access_token}`,
});

// Only GET reads. `requiresArg` cases are skipped unless the caller supplies a
// value, so the run stays clean instead of reporting fake failures.
const CHECKS = [
  { name: "user_data", path: "/services/restservice.svc/v2/getUserData" },
  { name: "contacts", path: "/services/restservice.svc/v4/contacts" },
  { name: "catalog_user_navigation", path: "/services/restservice.svc/v1/catalogUserNavigation" },
  {
    name: "validate_login_name",
    // Read-only availability probe. Uses YOUR OWN signed-in address by default:
    // it must not be used to enumerate whether arbitrary emails are registered.
    path: () => {
      const email = process.env.ALZA_SMOKE_EMAIL;
      return email ? `/services/restservice.svc/v1/validateLoginName?email=${encodeURIComponent(email)}` : null;
    },
    skipHint: "set ALZA_SMOKE_EMAIL to your own account email",
  },
  {
    name: "premium_trial",
    path: () => {
      const id = process.env.ALZA_SMOKE_USER_ID;
      return id ? `/api/user/${encodeURIComponent(id)}/v1/alzapremium/trial` : null;
    },
    skipHint: "set ALZA_SMOKE_USER_ID",
  },
  {
    name: "user_order",
    path: () => {
      const orderId = process.env.ALZA_SMOKE_ORDER_ID;
      const flag = process.env.ALZA_SMOKE_USER_FLAG ?? "0";
      return orderId ? `/api/users/${flag}/v1/orders/${encodeURIComponent(orderId)}` : null;
    },
    skipHint: "set ALZA_SMOKE_ORDER_ID (and optionally ALZA_SMOKE_USER_FLAG)",
  },
];

const results = [];

for (const check of CHECKS) {
  const path = typeof check.path === "function" ? check.path() : check.path;
  if (!path) {
    results.push({ name: check.name, status: "skipped", detail: check.skipHint });
    continue;
  }
  const started = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, { headers: headers() });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const ms = Date.now() - started;
    if (res.status === 401) {
      results.push({ name: check.name, status: "unauthorized", http: 401, ms,
        detail: "token expired or lacks scope — run scripts/alza-auth-refresh.mjs" });
    } else if (!res.ok) {
      results.push({ name: check.name, status: "http_error", http: res.status, ms,
        detail: typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200) });
    } else {
      results.push({ name: check.name, status: "ok", http: res.status, ms,
        keys: body && typeof body === "object" ? Object.keys(body).slice(0, 8) : undefined });
    }
  } catch (err) {
    results.push({ name: check.name, status: "error", ms: Date.now() - started, detail: err.message });
  }
}

if (asJson) {
  console.log(JSON.stringify({ baseUrl: BASE_URL, results }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`Alza authenticated read smoke — ${BASE_URL}\n`);
  for (const r of results) {
    const mark = { ok: "PASS", skipped: "SKIP", unauthorized: "AUTH", http_error: "FAIL", error: "FAIL" }[r.status];
    console.log(`  ${pad(mark, 5)} ${pad(r.name, 26)} ${pad(r.http ?? "-", 5)} ${pad(r.ms != null ? r.ms + "ms" : "", 8)} ${r.detail ?? (r.keys ? r.keys.join(",") : "")}`);
  }
  const failed = results.filter((r) => r.status === "http_error" || r.status === "error").length;
  const unauth = results.filter((r) => r.status === "unauthorized").length;
  console.log(`\n${results.filter((r) => r.status === "ok").length} ok, ${failed} failed, ${unauth} unauthorized, ${results.filter((r) => r.status === "skipped").length} skipped`);
  if (unauth) process.exitCode = 2;
  else if (failed) process.exitCode = 1;
}
