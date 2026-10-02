#!/usr/bin/env node
/**
 * End-to-end live verification: catalog → cart → delivery → checkout preview →
 * order submission → after-order payment, driven through the REAL MCP server
 * (buildServer + in-memory MCP client) exactly like an MCP consumer would.
 *
 * Prerequisites:
 *   1. npm run build
 *   2. python3 scripts/alza_auth_login.py gen && (browser step) &&
 *      python3 scripts/alza_auth_login.py exchange "<alza://identity redirect or code>"
 *      (tokens land in ~/.alza-mcp/tokens.json, loaded via ALZA_TOKEN_FILE)
 *
 *   node scripts/e2e-order-payment.mjs
 *
 * The driver is adaptive: live response shapes are not guaranteed to match the
 * APK model names, so it deep-scans responses for the fields it needs and logs
 * everything (raw results included) to docs/live-evidence/. Set
 * STOP_BEFORE_ORDER=1 to stop right before the order submission.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "../dist/server.js";

const TOKEN_FILE = process.env.ALZA_TOKEN_FILE ?? join(homedir(), ".alza-mcp", "tokens.json");
if (!existsSync(TOKEN_FILE)) {
  if (process.env.ALLOW_ANON === "1") {
    console.error("No token store — ALLOW_ANON=1 set, running the unauthenticated steps only (dry run).");
    process.env.ALZA_TOKEN_FILE = "none";
  } else {
    console.error(`No token store at ${TOKEN_FILE}. Run the PKCE login first (see header).`);
    process.exit(1);
  }
} else {
  process.env.ALZA_TOKEN_FILE = TOKEN_FILE;
}

const SEARCH_TERM = process.env.ALZA_E2E_SEARCH_TERM ?? "tužka";
const EVIDENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "live-evidence");

// ---------- adaptive response helpers (live shapes may differ from APK models) ----------

/** Deep-scan for the first object matching the predicate. */
function firstMatch(value, pred, depth = 0) {
  if (value === null || typeof value !== "object" || depth > 14) return undefined;
  if (pred(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) { const hit = firstMatch(item, pred, depth + 1); if (hit !== undefined) return hit; }
    return undefined;
  }
  for (const v of Object.values(value)) { const hit = firstMatch(v, pred, depth + 1); if (hit !== undefined) return hit; }
  return undefined;
}

/** Deep-scan for the first array of objects all/any having a key. */
function firstArrayOf(value, key, depth = 0) {
  if (value === null || typeof value !== "object" || depth > 14) return undefined;
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => v && typeof v === "object" && key in v)) return value;
    for (const item of value) { const hit = firstArrayOf(item, key, depth + 1); if (hit !== undefined) return hit; }
    return undefined;
  }
  for (const v of Object.values(value)) { const hit = firstArrayOf(v, key, depth + 1); if (hit !== undefined) return hit; }
  return undefined;
}

function firstId(value, names, depth = 0) {
  if (value === null || typeof value !== "object" || depth > 14) return undefined;
  for (const name of names) {
    const v = value[name];
    if (typeof v === "string" && v.length > 0 && v.length <= 64) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  if (Array.isArray(value)) { for (const item of value) { const hit = firstId(item, names, depth + 1); if (hit !== undefined) return hit; } return undefined; }
  for (const v of Object.values(value)) { const hit = firstId(v, names, depth + 1); if (hit !== undefined) return hit; }
  return undefined;
}

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined);

// ---------- driver ----------

const log = [];
const startedAt = new Date().toISOString();

async function main() {
  const { server, close } = buildServer({});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "e2e-order-payment", version: "1.0.0" });
  await client.connect(clientTransport);

  const call = async (tool, args, note = "") => {
    const t0 = Date.now();
    let res;
    try {
      res = await client.callTool({ name: tool, arguments: args });
    } catch (err) {
      log.push({ tool, args, note, error: String(err?.message ?? err), ms: Date.now() - t0 });
      throw err;
    }
    const text = res.content?.[0]?.text ?? "";
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    log.push({ tool, args, note, ms: Date.now() - t0, isError: Boolean(res.isError), result: parsed });
    if (res.isError) throw new Error(`${tool} failed: ${String(text).slice(0, 400)}`);
    return parsed;
  };
  const fail = (step, err) => {
    console.error(`E2E stopped at step "${step}": ${err?.message ?? err}`);
    writeLog();
    process.exitCode = 1;
  };

  try {
    // 0. Auth state (ALLOW_ANON=1 skips the requirement for dry-runs of the unauthenticated steps)
    const status = await call("alza_account_status", {}, "auth state");
    if (!status.authenticated && process.env.ALLOW_ANON !== "1") throw new Error("mobile API is not authenticated — login first (or set ALLOW_ANON=1 for a dry run)");

    // 1. Profile (A5) — account email + address book (non-fatal for anonymous dry runs)
    let profile;
    try {
      profile = await call("alza_profile", {}, "user data (address book)");
    } catch (err) {
      console.error(`profile read failed (${err.message}); continuing without account data`);
      profile = {};
    }
    const email = firstId(profile, ["email", "login", "loginName"]) ?? "anonymous";
    const addressId = firstMatch(profile, (o) => typeof o === "object" && num(o.id) !== undefined && (typeof o.street === "string" || typeof o.address === "string"))?.id;

    // 2. Catalog search (C1 whitelist) — cheapest product with a usable code
    const search = await call("alza_mobile_read", { operation: "search", args: { search_term: SEARCH_TERM, page: 0 } }, `search "${SEARCH_TERM}"`);
    const products = firstArrayOf(search, "code") ?? firstArrayOf(search, "productCode");
    if (!products) throw new Error("no product list with `code` fields found in search response");
    const priced = products.filter((p) => num(p.price ?? p.priceIncludingVat ?? p.priceCzk) !== undefined && typeof (p.code ?? p.productCode) === "string");
    if (priced.length === 0) throw new Error("no priced products with codes in search response");
    priced.sort((a, b) => (num(a.price ?? a.priceIncludingVat ?? a.priceCzk) ?? Infinity) - (num(b.price ?? b.priceIncludingVat ?? b.priceCzk) ?? Infinity));
    const product = priced[0];
    const productCode = product.code ?? product.productCode;
    const productPrice = num(product.price ?? product.priceIncludingVat ?? product.priceCzk);
    console.log(`cheapest: ${product.name ?? product.code ?? productCode} @ ${productPrice} (code=${productCode})`);

    // 3. Add to cart (B3)
    await call("alza_add_to_cart", { code: productCode, quantity: 1 }, "add cheapest product");

    // 4. Cart reads (B1/B2)
    const cart = await call("alza_cart", {}, "cart info + items");
    await call("alza_mobile_read", { operation: "basket_info", args: {} }, "basket_info (whitelist)");
    const consents = (firstArrayOf(cart, "consentId") ?? []).map((c) => ({ consentId: c.consentId, value: true }));

    // 5. Delivery options (D1) — pick the cheapest option
    const delivery = await call("alza_delivery_options", {}, "delivery + payment groups");
    const option = firstMatch(delivery, (o) => o && typeof o === "object" && num(o.id ?? o.optionId ?? o.deliveryId) !== undefined && (typeof o.name === "string" || typeof o.deliveryName === "string"));
    if (!option) throw new Error("no selectable delivery option found in delivery response");
    const optionId = num(option.id ?? option.optionId ?? option.deliveryId);
    console.log(`delivery: ${option.name ?? option.deliveryName} (id=${optionId})`);

    // 6. Payment methods (PA1) — pick one (prefer bank transfer for after-order payment)
    const payments = await call("alza_payment_methods", { selected_delivery_option_id: optionId }, "payment methods");
    const payItems = firstArrayOf(payments, "id") ?? firstArrayOf(payments, "paymentId") ?? [];
    const pick = payItems.find((p) => /převod|bank|transfer|faktura|invoice/i.test(String(p.name ?? p.paymentName ?? ""))) ?? payItems[0];
    if (!pick) throw new Error("no payment methods found in payment response");
    const paymentId = num(pick.id ?? pick.paymentId ?? pick.methodId);
    if (paymentId === undefined) throw new Error("could not extract a numeric payment id from payment response");
    console.log(`payment: ${pick.name ?? pick.paymentName ?? "(unnamed)"} (paymentId=${paymentId})`);

    if (process.env.STOP_BEFORE_ORDER === "1") { console.log("STOP_BEFORE_ORDER=1 — stopping before order submission."); writeLog(); return; }

    // 7. Checkout preview (O1 + token)
    const preview = await call("alza_checkout_preview", { selected_delivery_option_id: optionId }, "checkout preview (sendOrder1 + token)");
    const token = preview.confirmationToken;

    // 8. Order submission (O2-O5) with APK DTOs
    const deliveryPayload = {
      selectedDeliveryOptionId: optionId,
      paymentId,
      deliveryName: option.name ?? option.deliveryName,
      deliveryZipCode: option.zipCode ?? option.zip ?? option.deliveryZipCode,
      deliveryCity: option.city ?? option.deliveryCity,
      deliveryStreet: option.street ?? option.deliveryStreet,
      deliveryAddressId: num(option.deliveryAddressId ?? option.addressId),
      deliveryGroups: [],
    };
    Object.keys(deliveryPayload).forEach((k) => { if (deliveryPayload[k] === undefined) delete deliveryPayload[k]; });
    const userInfo = { parameters: { ...(email && email !== "unknown" ? { email } : {}) } };
    const completeOrder = { consents, basketConsents: consents, saveCard: false };
    const placed = await call("alza_place_order", { confirmation_token: token, delivery_payment: deliveryPayload, user_info: userInfo, complete_order: completeOrder }, "order submission (sendOrder2→orderfinished)");
    const orderId = firstId(placed, ["orderId", "id", "orderNumber", "invoiceNumber"]) ?? firstId(placed, ["invoice"]);
    const invoiceNumber = firstId(placed, ["invoiceNumber", "invoice"]) ?? orderId;
    if (!orderId) throw new Error(`could not extract an order id from the placement result: ${JSON.stringify(placed).slice(0, 300)}`);
    console.log(`order placed: ${orderId} (invoice=${invoiceNumber})`);

    // 9. Order read (OR1) — part id
    const orderRead = await call("alza_order", { order_id: orderId, user_flag: 0 }, "order read (milestones, parts)");
    const partId = firstId(firstMatch(orderRead, (o) => o && typeof o === "object" && Array.isArray(o.parts))?.parts ?? orderRead, ["partId", "id"]) ?? orderId;
    if (partId === undefined || partId === "") throw new Error("could not extract a part id from the order response");

    // 10. After-order payment options (PA2)
    const afterPays = await call("alza_after_order_payments", { order_id: orderId, part_id: String(partId) }, "after-order payment options");
    const afterItem = firstMatch(afterPays, (o) => o && typeof o === "object" && num(o.paymentId ?? o.id ?? o.methodId) !== undefined) ?? afterPays;
    const afterPaymentId = num(afterItem.paymentId ?? afterItem.id ?? afterItem.methodId) ?? paymentId;
    const cardId = num(afterItem.cardId ?? firstMatch(afterPays, (o) => o && typeof o === "object" && num(o.cardId) !== undefined)?.cardId);
    console.log(`after-order payment: paymentId=${afterPaymentId}${cardId !== undefined ? ` cardId=${cardId}` : ""}`);

    // 11. Payment execution (PA3) with one-time token
    const prep = await call("alza_prepare_mutation", { action: "after_order_payment" }, "prepare after_order_payment token");
    const paid = await call("alza_pay_after_order", {
      order_id: orderId,
      invoice_number: String(invoiceNumber),
      payment_id: afterPaymentId,
      ...(cardId !== undefined ? { card_id: cardId } : {}),
      confirmation_token: prep.confirmationToken,
    }, "after-order payment execution (afterOrderPayment)");

    // 12. Final order state (OR1)
    const finalOrder = await call("alza_order", { order_id: orderId, part_id: String(partId) }, "final order read (payment state)");

    // 13. Evidence
    const evidence = {
      started_at: startedAt,
      account_email: email,
      product: { code: productCode, name: product.name ?? null, price: productPrice },
      delivery_option: { id: optionId, name: option.name ?? option.deliveryName ?? null },
      payment_method: { id: paymentId, name: pick.name ?? pick.paymentName ?? null, executed_payment_id: afterPaymentId, card_id: cardId ?? null },
      order: {
        order_id: orderId,
        invoice_number: invoiceNumber,
        part_id: String(partId),
        placement_result: placed,
        payment_result: paid,
        final_state: finalOrder,
      },
      steps: log,
    };
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const jsonPath = join(EVIDENCE_DIR, "e2e-order-payment.json");
    writeFileSync(jsonPath, JSON.stringify(evidence, null, 2) + "\n");
    const mdPath = join(EVIDENCE_DIR, "e2e-order-payment.md");
    writeFileSync(mdPath, renderMarkdown(evidence));
    console.log(`E2E complete: order ${orderId}, payment ${JSON.stringify({ paymentId: afterPaymentId, cardId: cardId ?? null })}`);
    console.log(`evidence: ${mdPath}\n        ${jsonPath}`);
    await client.close();
    await close();
    process.exit(0);
  } catch (err) {
    fail("uncaught", err);
    await close();
  }

  function writeLog() {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "live-evidence");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "e2e-order-payment-partial.json");
    writeFileSync(p, JSON.stringify({ started_at: startedAt, steps: log }, null, 2) + "\n");
    console.error(`partial log: ${p}`);
  }
}

function renderMarkdown(e) {
  const steps = e.steps.map((s, i) => {
    const err = s.error ? ` — **error**: ${s.error}` : s.isError ? " — tool error" : "";
    return `${i + 1}. \`${s.tool}\` ${JSON.stringify(s.args ?? {})?.slice(0, 220)}${err}`;
  }).join("\n");
  return `# E2E live order + payment record

- Date: ${e.started_at}
- Account: ${e.account_email}
- Product: \`${e.product.code}\` (${e.product.name ?? "unnamed"}, price ${e.product.price})
- Delivery: ${e.delivery_option.name ?? "unknown"} (option id ${e.delivery_option.id})
- Payment method: ${e.payment_method.name ?? "unknown"} (paymentId ${e.payment_method.id}, executed paymentId ${e.payment_method.executed_payment_id}${e.payment_method.card_id !== null ? `, cardId ${e.payment_method.card_id}` : ""})
- **Order ID: \`${e.order.order_id}\`** (invoice \`${e.order.invoice_number}\`, part \`${e.order.part_id}\`)

## Payment result (raw \`afterOrderPayment\` response)

\`\`\`json
${JSON.stringify(e.order.payment_result, null, 2)}
\`\`\`

## Final order state (payment-relevant fields)

\`\`\`json
${JSON.stringify(e.order.final_state, null, 2).slice(0, 4000)}
\`\`\`

## Tool calls (MCP tool path)

${steps}

## Notes

- Driven through the real MCP server (buildServer + in-memory MCP client), the same tool calls an MCP consumer would make.
- Transport: Node undici from this egress; Cloudflare may return 403 challenges to some endpoints (see docs/mobile-endpoint-coverage.md transport note).
- Raw step log: \`e2e-order-payment.json\`.
`;
}

main().catch((err) => { console.error(err); process.exit(1); });
