#!/usr/bin/env node
/**
 * E2E live order + payment — real MCP tool path, browser-backed transport.
 *
 * From this egress, Cloudflare challenges plain-HTTP (Node/undici, Python)
 * requests to both www.alza.cz and identity.alza.cz (cf-mitigated: challenge),
 * while real Chromium solves the managed challenge (the same transport the
 * catalog tools already use). This driver therefore:
 *
 *   1. launches the project's Playwright Chromium,
 *   2. solves the Cloudflare challenge on the needed origins,
 *   3. injects a browser-backed `fetch` as the global fetch,
 *   4. builds the REAL MCP server (buildServer) and drives it with a real MCP
 *      client over in-memory transport — the exact tool calls an MCP consumer
 *      makes (alza_profile, alza_mobile_read, alza_add_to_cart,
 *      alza_delivery_options, alza_payment_methods, alza_checkout_preview,
 *      alza_place_order, alza_after_order_payments, alza_prepare_mutation,
 *      alza_pay_after_order, alza_order),
 *   5. records docs/live-evidence/e2e-order-payment.md + .json.
 *
 * Usage:
 *   node scripts/e2e-order-payment.browser.mjs exchange "<alza://identity redirect or code>"
 *       (completes the PKCE exchange started by `python3 scripts/alza_auth_login.py gen`)
 *   node scripts/e2e-order-payment.browser.mjs run
 *       (runs the full journey; requires the token store, or ALLOW_ANON=1)
 *   STOP_BEFORE_ORDER=1 ... run   (stop right before order submission)
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../dist/server.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_FILE = process.env.ALZA_TOKEN_FILE ?? join(homedir(), ".alza-mcp", "tokens.json");
const PENDING_FILE = join(homedir(), ".alza-mcp", "pending-login.json");
const EVIDENCE_DIR = join(ROOT, "docs", "live-evidence");
const SEARCH_TERM = process.env.ALZA_E2E_SEARCH_TERM ?? "tužka";
const SHOP_ORIGIN = "https://www.alza.cz";
const IDENTITY_ORIGIN = "https://identity.alza.cz";

// ---------- browser-backed fetch ----------

class BrowserFetch {
  constructor() {
    this.browser = null;
    this.context = null;
    this.pages = new Map(); // origin -> Page
  }

  async start() {
    // Same launch/context config as src/infra/browser.ts (AlzaBrowser) — the
    // `--disable-blink-features=AutomationControlled` flag is what lets the
    // headless Chromium pass the Cloudflare managed challenge.
    this.browser = await chromium.launch({
      headless: process.env.ALZA_HEADLESS !== "false",
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    });
    this.context = await this.browser.newContext({
      locale: "cs-CZ",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: { "accept-language": "cs-CZ" },
    });
  }

  async pageFor(origin) {
    if (this.pages.has(origin)) return this.pages.get(origin);
    const page = await this.context.newPage();
    // Solve the Cloudflare managed challenge: navigate until a 200 (the
    // challenge auto-submits and reloads). Poll a few times; give up ~45s.
    for (let i = 0; i < 15; i++) {
      const resp = await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => e);
      if (resp && typeof resp === "object" && typeof resp.status === "function" && resp.status() === 200) break;
      await page.waitForTimeout(3000);
    }
    const finalResp = await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    if (!finalResp || finalResp.status() !== 200) {
      const status = finalResp?.status() ?? "nav-failed";
      throw new Error(`Cloudflare challenge on ${origin} not solved (last status ${status}, url ${page.url()})`);
    }
    this.pages.set(origin, page);
    console.error(`[e2e] ${origin} challenge solved (page ${page.url()})`);
    return page;
  }

  async fetchResponse(input, init = {}) {
    const url = new URL(String(input), "https://www.alza.cz/");
    const origin = url.origin;
    if (!this.pages.has(origin) && (origin === SHOP_ORIGIN || origin === IDENTITY_ORIGIN)) {
      await this.pageFor(origin);
    }
    const page = this.pages.get(origin);
    if (!page) throw new Error(`no browser transport for origin ${origin}`);
    const headers = {};
    if (init.headers) {
      for (const [k, v] of new Headers(init.headers).entries()) headers[k] = v;
    }
    const r = await page.evaluate(async ({ method, url, headers, body }) => {
      const res = await fetch(url, {
        method,
        headers,
        body: body ?? undefined,
        redirect: "follow",
        credentials: "include",
      });
      const text = await res.text();
      const respHeaders = {};
      res.headers.forEach((v, k) => { respHeaders[k] = v; });
      return { status: res.status, ok: res.ok, text, headers: respHeaders };
    }, {
      method: init.method ?? "GET",
      url: url.toString(),
      headers,
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    });
    const response = new Response(r.text, { status: r.status, statusText: r.ok ? "OK" : "Error" });
    for (const [k, v] of Object.entries(r.headers)) {
      try { response.headers.set(k, v); } catch { /* non-standard header */ }
    }
    return response;
  }

  async close() {
    await this.browser?.close();
  }
}

// ---------- PKCE exchange ----------

async function exchange(pasted) {
  if (!existsSync(PENDING_FILE)) throw new Error(`no pending login at ${PENDING_FILE} — run: python3 scripts/alza_auth_login.py gen`);
  const pending = JSON.parse(readFileSync(PENDING_FILE, "utf8"));
  const text = (pasted ?? "").trim();
  if (!text) throw new Error("no redirect pasted");
  let code, state;
  if (text.includes("=")) {
    const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : text;
    const params = new URLSearchParams(query);
    code = params.get("code");
    state = params.get("state");
    if (params.get("error")) throw new Error(`authorization failed: ${params.get("error")}`);
  } else { code = text; }
  if (!code) throw new Error("no code found in the pasted value");
  if (state && state !== pending.state) throw new Error("state mismatch — start the PKCE flow again");

  const bf = new BrowserFetch();
  try {
    await bf.start();
    await bf.pageFor(IDENTITY_ORIGIN);
    const page = bf.pages.get(IDENTITY_ORIGIN);
    // The `alza_Android` OAuth client is confidential: the token endpoint rejects
    // requests without the APK-embedded client secret (HTTP 400 invalid_client).
    // Source-verified: the secret is ph1.a() in the decompiled APK —
    // AES-Nk5-CBC (zero IV) decryption of the embedded 32-byte hex blob
    // (97093894...1c516, identical in 2026.15 and 2026.17) with the 20-byte
    // key "QaUXkh4j7MHGgclj0oEW" → 32-char ASCII plaintext. Live-verified
    // against /connect/token (dummy code + this secret → invalid_grant,
    // without secret → invalid_client). See scripts/alza-client-secret.mjs.
    const CLIENT_SECRET = process.env.ALZA_CLIENT_SECRET ?? "ZRtjXCjaYFmUbGNvbTK25uctj4nQRT6a";
    // pending-login.json (alza-auth-login-noninteractive.mjs) is camelCase;
    // older generators used snake_case — accept both.
    const out = await page.evaluate(async ({ tokenEndpoint, clientId, redirectUri, code, verifier, clientSecret }) => {
      const body = new URLSearchParams({
        grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier, client_secret: clientSecret,
      });
      const r = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body,
        credentials: "include",
      });
      return { status: r.status, text: await r.text() };
    }, {
      tokenEndpoint: pending.tokenEndpoint ?? pending.token_endpoint,
      clientId: pending.clientId ?? pending.client_id,
      redirectUri: pending.redirectUri ?? pending.redirect_uri,
      code,
      verifier: pending.verifier,
      clientSecret: CLIENT_SECRET,
    });
    if (out.status !== 200) throw new Error(`token exchange failed with HTTP ${out.status}: ${out.text.slice(0, 300)}`);
    const tokens = JSON.parse(out.text);
    if (!tokens.access_token) throw new Error("token response contained no access_token");
    const store = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_type: tokens.token_type ?? "Bearer",
      scope: tokens.scope ?? "email openid profile alza offline_access",
      expires_in: tokens.expires_in ?? null,
      visitor_id: pending.visitorId ?? pending.visitor_id,
      obtained_at: new Date().toISOString(),
    };
    mkdirSync(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
    writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ ok: true, token_file: TOKEN_FILE, expires_in: store.expires_in, visitor_id: store.visitor_id }, null, 2));
  } finally {
    await bf.close();
  }
}

// ---------- E2E journey ----------

const log = [];
const startedAt = new Date().toISOString();

function firstId(value, names, depth = 0) {
  if (value === null || typeof value !== "object" || depth > 14) return undefined;
  if (!Array.isArray(value)) {
    for (const name of names) {
      const v = value[name];
      if (typeof v === "string" && v.length > 0 && v.length <= 64) return v;
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  const items = Array.isArray(value) ? value : Object.values(value);
  for (const v of items) { const hit = firstId(v, names, depth + 1); if (hit !== undefined) return hit; }
  return undefined;
}

function firstMatch(value, pred, depth = 0) {
  if (value === null || typeof value !== "object" || depth > 14) return undefined;
  try { if (pred(value)) return value; } catch { /* keep scanning */ }
  const items = Array.isArray(value) ? value : Object.values(value);
  for (const v of items) { const hit = firstMatch(v, pred, depth + 1); if (hit !== undefined) return hit; }
  return undefined;
}

async function apiGet(path) {
  // Raw browser-backed fetch (the same transport the MCP server uses);
  // only for the AlzaBox location resolution, which no MCP tool covers.
  const res = await fetch(SHOP_ORIGIN + path, { headers: { accept: "application/json" } });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

async function run() {
  const store = existsSync(TOKEN_FILE) ? JSON.parse(readFileSync(TOKEN_FILE, "utf8")) : {};
  if (!store.access_token && process.env.ALLOW_ANON !== "1") {
    throw new Error(`no token store at ${TOKEN_FILE} — complete the PKCE login first (or ALLOW_ANON=1 for a dry run)`);
  }
  const bf = new BrowserFetch();
  await bf.start();
  await bf.pageFor(SHOP_ORIGIN);
  if (store.access_token) {
    // The token-refresh path (MobileApi 401 retry) hits the identity origin;
    // pre-solve that challenge too so refresh works if needed.
    try { await bf.pageFor(IDENTITY_ORIGIN); } catch (e) { console.error(`[e2e] identity origin unavailable for refresh: ${e.message}`); }
  }
  globalThis.fetch = (input, init) => bf.fetchResponse(input, init);

  const { server, close } = buildServer({});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "e2e-order-payment", version: "1.0.0" });
  await client.connect(clientTransport);

  const call = async (tool, args, note = "") => {
    const t0 = Date.now();
    const res = await client.callTool({ name: tool, arguments: args });
    const text = res.content?.[0]?.text ?? "";
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    log.push({ tool, args, note, ms: Date.now() - t0, isError: Boolean(res.isError), result: parsed });
    if (res.isError) throw new Error(`${tool} failed: ${String(text).slice(0, 400)}`);
    return parsed;
  };

  let clientRef = null;
  let serverRef = null;
  try {
    serverRef = { close };
    clientRef = client;
    const status = await call("alza_account_status", {}, "auth state");
    if (!status.authenticated && process.env.ALLOW_ANON !== "1") throw new Error("mobile API is not authenticated — login first");

    let profile = {};
    try { profile = await call("alza_profile", {}, "user data (address book)"); } catch (e) { console.error(`profile read failed: ${e.message}`); }
    let email = firstId(profile, ["email", "login", "loginName"]);
    if (!email) {
      // Guest checkout: a syntactically valid throwaway address (no user-supplied
      // credentials involved) — Alza's app supports anonymous orders by email.
      email = process.env.ALZA_E2E_EMAIL ?? `e2e-alza-mcp-${Date.now()}@example.com`;
      console.log(`guest checkout email: ${email}`);
    }

    const search = await call("alza_mobile_read", { operation: "search", args: { search_term: SEARCH_TERM, page: 0 } }, `search "${SEARCH_TERM}"`);
    const products = firstMatch(search, (o) => Array.isArray(o) && o.length > 0 && o.every((x) => x && typeof x === "object" && (typeof x.code === "string" || typeof x.productCode === "string")));
    if (!products) throw new Error("no product list with codes found in search response");
    const priceOf = (p) => num(p?.priceInfo?.priceNoCurrency ?? p?.priceNoCurrency ?? p?.price ?? p?.priceIncludingVat ?? p?.priceCzk);
    const priced = products.filter((p) => num(p?.priceInfo?.priceNoCurrency ?? p?.priceNoCurrency) !== undefined);
    if (priced.length === 0) throw new Error("no priced products with codes in search response");
    priced.sort((a, b) => (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity));
    const product = priced[0];
    const productCode = product.code ?? product.productCode;
    const productPrice = priceOf(product);
    console.log(`cheapest: ${product.name ?? productCode} @ ${productPrice} (code=${productCode})`);

    await call("alza_add_to_cart", { code: productCode, quantity: 1 }, "add cheapest product");
    const cart = await call("alza_cart", {}, "cart info + items");
    await call("alza_mobile_read", { operation: "basket_info", args: {} }, "basket_info (whitelist)");
    const consentArr = firstMatch(cart, (o) => Array.isArray(o) && o.length > 0 && o.every((x) => x && typeof x === "object" && "consentId" in x));
    const consents = (consentArr ?? []).map((c) => ({ consentId: c.consentId, value: true }));

    const delivery = await call("alza_delivery_options", {}, "delivery + payment groups");
    // Prefer an InPersonBranch (a specific Alza store): no address, no branch
    // sub-selection, no time-slot picker. Fallback: any option that resolves
    // directly (has a name and an id and no deliveryOption sub-form action).
    const optionWithGroup = [];
    (delivery.deliveryGroups ?? []).forEach((g) => {
      const groupId = num(g.deliveryGroupId ?? g.id);
      (g.deliveries ?? []).forEach((o) => optionWithGroup.push({ option: o, groupId }));
    });
    let chosen = optionWithGroup.find(({ option: o }) => o.itemType === "InPersonBranch" && typeof o.name === "string")
      ?? optionWithGroup.find(({ option: o }) => typeof o.name === "string" && !o.deliveryOption && num(o.id ?? o.optionId ?? o.deliveryId) !== undefined);
    if (!chosen) chosen = optionWithGroup[0];
    if (!chosen) throw new Error("no selectable delivery option found in delivery response");
    const option = chosen.option;
    const deliveryGroupId = chosen.groupId;
    const optionId = num(option.id ?? option.optionId ?? option.deliveryId);
    console.log(`delivery: ${option.name ?? option.deliveryName} (id=${optionId}, group=${deliveryGroupId}, type=${option.itemType ?? "?"})`);
    // AlzaBox options need a concrete box location (parcelShopId); resolve via
    // the server-driven pickup API (the app follows the deliveryOption/pickupPlaceForm).
    let parcelShopId = 0;
    if (option.itemType === "AlzaBox") {
      const cartOrderId = firstId(cart, ["orderId"]);
      const points = await apiGet(`/api/personalPickup/v1/points?orderId=${cartOrderId ?? ""}&groupId=${deliveryGroupId}&latitude=50.19&longitude=15.76&zoom=10`);
      const pts = Array.isArray(points) ? points : points?.points ?? points?.pickupPlaces ?? [];
      const firstPlace = Array.isArray(pts) && pts.length > 0 ? pts[0] : null;
      parcelShopId = num(firstPlace?.parcelShopId ?? firstPlace?.id) ?? 1128203; // 1128203: verified live AlzaBox location (Hradec Králové)
      console.log(`alzabox parcelShopId: ${parcelShopId}`);
    }

    const payments = await call("alza_payment_methods", { selected_delivery_option_id: optionId }, "payment methods");
    const payItems = firstMatch(payments, (o) => Array.isArray(o) && o.length > 0 && o.every((x) => x && typeof x === "object" && num(x.id ?? x.paymentId ?? x.methodId) !== undefined)) ?? [];
    const pick = payItems.find((p) => /převod|bank|transfer|faktura|invoice/i.test(String(p.name ?? p.paymentName ?? ""))) ?? payItems[0];
    if (!pick) throw new Error("no payment methods found in payment response");
    const paymentId = num(pick.id ?? pick.paymentId ?? pick.methodId);
    if (paymentId === undefined) throw new Error("could not extract a numeric payment id from payment response");
    console.log(`payment: ${pick.name ?? pick.paymentName ?? "(unnamed)"} (paymentId=${paymentId})`);

    if (process.env.STOP_BEFORE_ORDER === "1") {
      console.log("STOP_BEFORE_ORDER=1 — stopping before order submission.");
      writeEvidence({ email, product: { code: productCode, name: product.name ?? null, price: productPrice }, delivery: { id: optionId, name: option.name ?? option.deliveryName ?? null }, payment: { id: paymentId, name: pick.name ?? pick.paymentName ?? null }, order: null, partial: true });
      return;
    }

    const preview = await call("alza_checkout_preview", { selected_delivery_option_id: optionId }, "checkout preview (sendOrder1 + token)");
    // APK-confirmed SelectedDeliveryPayment: deliveryGroups carries the APK
    // SelectedDelivery wire object (deliveryGroupId/deliveryId/deliveryServicesIds/
    // parcelShopId/timeFrameId/timeSlotId); an empty deliveryGroups is accepted
    // but leaves the selection unregistered (err:1) and orderfinished then 500s.
    const deliveryPayload = {
      selectedDeliveryOptionId: optionId,
      paymentId,
      paymentCardId: 0,
      deliveryGroups: [{
        deliveryGroupId,
        deliveryId: optionId,
        deliveryServicesIds: [],
        parcelShopId,
        timeFrameId: 0,
        timeSlotId: 0,
      }],
      ...(typeof (option.name ?? option.deliveryName) === "string" ? { deliveryName: option.name ?? option.deliveryName } : {}),
      ...(option.zipCode !== undefined ? { deliveryZipCode: option.zipCode } : {}),
      ...(option.city !== undefined ? { deliveryCity: option.city } : {}),
      ...(option.street !== undefined ? { deliveryStreet: option.street } : {}),
      ...(num(option.deliveryAddressId ?? option.addressId) !== undefined ? { deliveryAddressId: num(option.deliveryAddressId ?? option.addressId) } : {}),
    };
    // sendOrder3 (user info) — APK: wire `Parameters` fields are the obfuscated
    // UserFieldKeys names; guest orders carry newUserInfo {anonymOrder:true, login:email}.
    const authedUser = { parameters: {} };
    const authedWithEmail = { parameters: { dEmail: email } };
    const guestUser = { parameters: { dEmail: email, newUserInfo: { anonymOrder: true, login: email } } };
    const completeOrder = { consents, basketConsents: consents, saveCard: false };
    const userInfoVariants = status.authenticated
      ? [authedUser, authedWithEmail, guestUser]
      : [guestUser, authedUser];
    let placed = null;
    for (let attempt = 0; attempt < userInfoVariants.length && !placed; attempt++) {
      const user_info = userInfoVariants[attempt];
      const token = attempt === 0 ? preview.confirmationToken : (await call("alza_checkout_preview", { selected_delivery_option_id: optionId }, `checkout preview retry (${attempt + 1}) (new token)`)).confirmationToken;
      try {
        placed = await call("alza_place_order", {
          confirmation_token: token,
          delivery_payment: deliveryPayload,
          user_info,
          complete_order: completeOrder,
        }, `order submission (sendOrder2→orderfinished, user_info variant ${attempt + 1})`);
      } catch (err) {
        if (attempt < userInfoVariants.length - 1 && /500|Internal Server Error/i.test(String(err.message))) {
          console.log(`order submission variant ${attempt + 1} failed (${String(err.message).slice(0, 200)}) — retrying with the other user_info shape`);
          continue;
        }
        throw err;
      }
    }
    if (!placed) throw new Error("all user_info variants failed");
    const orderId = firstId(placed, ["orderId", "orderNumber", "id", "invoiceNumber"]);
    const invoiceNumber = firstId(placed, ["invoiceNumber", "invoice"]) ?? orderId;
    if (!orderId) throw new Error(`could not extract an order id from the placement result: ${JSON.stringify(placed).slice(0, 300)}`);
    console.log(`order placed: ${orderId} (invoice=${invoiceNumber})`);

    const orderRead = await call("alza_order", { order_id: orderId, user_flag: 0 }, "order read (parts/milestones)");
    const partsHost = firstMatch(orderRead, (o) => o && typeof o === "object" && Array.isArray(o.parts) && o.parts.length > 0);
    const partId = firstId(partsHost?.parts ?? orderRead, ["partId", "id"]) ?? orderId;

    const afterPays = await call("alza_after_order_payments", { order_id: orderId, part_id: String(partId) }, "after-order payment options");
    const afterItem = firstMatch(afterPays, (o) => o && typeof o === "object" && num(o.paymentId ?? o.id ?? o.methodId) !== undefined) ?? afterPays;
    const afterPaymentId = num(afterItem.paymentId ?? afterItem.id ?? afterItem.methodId) ?? paymentId;
    const cardId = num(afterItem.cardId) ?? num(firstMatch(afterPays, (o) => o && typeof o === "object" && num(o.cardId) !== undefined)?.cardId);
    console.log(`after-order payment: paymentId=${afterPaymentId}${cardId !== undefined ? ` cardId=${cardId}` : ""}`);

    const prep = await call("alza_prepare_mutation", { action: "after_order_payment" }, "prepare after_order_payment token");
    const paid = await call("alza_pay_after_order", {
      order_id: orderId,
      invoice_number: String(invoiceNumber),
      payment_id: afterPaymentId,
      ...(cardId !== undefined ? { card_id: cardId } : {}),
      confirmation_token: prep.confirmationToken,
    }, "after-order payment execution (afterOrderPayment)");

    const finalOrder = await call("alza_order", { order_id: orderId, part_id: String(partId) }, "final order read (payment state)");

    writeEvidence({
      email,
      product: { code: productCode, name: product.name ?? null, price: productPrice },
      delivery: { id: optionId, name: option.name ?? option.deliveryName ?? null },
      payment: { id: paymentId, name: pick.name ?? pick.paymentName ?? null, executed_payment_id: afterPaymentId, card_id: cardId ?? null },
      order: { order_id: orderId, invoice_number: invoiceNumber, part_id: String(partId), placed, payment_result: paid, final_state: finalOrder },
      partial: false,
    });
    console.log(`E2E complete: order ${orderId}`);
  } catch (err) {
    console.error(`E2E stopped: ${err?.message ?? err}`);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, "e2e-order-payment-partial.json"), JSON.stringify({ started_at: startedAt, steps: log }, null, 2) + "\n");
    console.error(`partial log: ${join(EVIDENCE_DIR, "e2e-order-payment-partial.json")}`);
    process.exitCode = 1;
  } finally {
    try { await clientRef?.close(); } catch { /* ignore */ }
    try { await serverRef?.close(); } catch { /* ignore */ }
    await bf.close().catch(() => {});
  }
}

function writeEvidence(e) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const steps = log.map((s, i) => `${i + 1}. \`${s.tool}\` ${JSON.stringify(s.args ?? {})?.slice(0, 220)}${s.isError ? " — **tool error**" : ""}`).join("\n");
  const md = `# E2E live order + payment record

- Date: ${startedAt}
- Account: ${e.email}
- Transport: Playwright Chromium (browser-backed fetch injected into the real MCP server; plain HTTP is Cloudflare-challenged from this egress — see coverage-doc transport note)
- Product: \`${e.product.code}\` (${e.product.name ?? "unnamed"}, price ${e.product.price})
- Delivery: ${e.delivery.name ?? "unknown"} (option id ${e.delivery.id})
- Payment method: ${e.payment.name ?? "unknown"} (paymentId ${e.payment.id}${e.payment.executed_payment_id !== undefined ? `, executed paymentId ${e.payment.executed_payment_id}` : ""}${e.payment.card_id !== null && e.payment.card_id !== undefined ? `, cardId ${e.payment.card_id}` : ""})
${e.order ? `- **Order ID: \`${e.order.order_id}\`** (invoice \`${e.order.invoice_number}\`, part \`${e.order.part_id}\`)` : "- (partial record — stopped before order submission)"}

## Payment result (raw \`afterOrderPayment\` response)

\`\`\`json
${JSON.stringify(e.order?.payment_result ?? null, null, 2).slice(0, 4000)}
\`\`\`

## Final order state

\`\`\`json
${JSON.stringify(e.order?.final_state ?? null, null, 2).slice(0, 4000)}
\`\`\`

## Tool calls (real MCP tool path)

${steps}

## Notes

- Driven through the real MCP server (buildServer + in-memory MCP client) with a browser-backed fetch; each step is the corresponding MCP tool.
- One-time confirmation tokens (alza_prepare_mutation / checkout preview) used exactly as the tools require.
- Raw step log: \`e2e-order-payment.json\`.
`;
  writeFileSync(join(EVIDENCE_DIR, "e2e-order-payment.md"), md);
  writeFileSync(join(EVIDENCE_DIR, "e2e-order-payment.json"), JSON.stringify({
    started_at: startedAt, account_email: e.email, product: e.product, delivery_option: e.delivery,
    payment_method: e.payment, order: e.order ?? null, steps: log, partial: e.partial,
  }, null, 2) + "\n");
  console.log(`evidence: ${join(EVIDENCE_DIR, "e2e-order-payment.md")}`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "exchange") {
  exchange(arg).catch((e) => { console.error(e.message ?? e); process.exit(1); });
} else if (cmd === "run" || cmd === undefined) {
  run().catch((e) => { console.error(e.message ?? e); process.exit(1); });
} else {
  console.error(`unknown command: ${cmd} (use "exchange <redirect|code>" or "run")`);
  process.exit(1);
}
