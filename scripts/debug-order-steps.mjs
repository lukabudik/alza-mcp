#!/usr/bin/env node
/**
 * Debug v3: sendOrder3 user-info payload matrix (branch delivery) +
 * AlzaBox association-based sendOrder2.
 * Usage: node scripts/debug-order-steps.mjs
 */
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";

const BASE = "https://www.alza.cz";
const GUID = randomUUID();
const EMAIL = `e2e-debug-${Date.now()}@example.com`;

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    locale: "cs-CZ",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await ctx.newPage();
  for (let i = 0; i < 15; i++) {
    const r = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    if (r && r.status() === 200) break;
    await page.waitForTimeout(3000);
  }

  const api = (path, { method = "GET", body } = {}) =>
    page.evaluate(
      async ({ method, url, body, headers }) => {
        const res = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: "include",
        });
        const text = await res.text();
        let json; try { json = JSON.parse(text); } catch { json = text; }
        return { status: res.status, json, raw: typeof json === "string" ? text : undefined };
      },
      {
        method,
        url: BASE + path,
        body,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "Alza/2026.15.0 (Android)",
          "accept-language": "cs-CZ,cs;q=0.9,en;q=0.8",
          "Balancer-Guid": GUID,
          "x-correlation-id": randomUUID(),
        },
      },
    );

  const add = await api("/services/restservice.svc/v2/basket/add", { method: "POST", body: { code: "CEN178a", amount: 1 } });
  console.log("basket/add:", add.status);

  const groups = await api("/services/restservice.svc/v12/getDeliveryPaymentGroups");
  const g0 = (groups.json?.deliveryGroups ?? [])[0] ?? {};
  const groupId = g0.deliveryGroupId;
  const sel = (deliveryId, extra = {}) => ({ deliveryGroupId: groupId, deliveryId, deliveryServicesIds: [], parcelShopId: 0, timeFrameId: 0, timeSlotId: 0, ...extra });

  // AlzaBox: association ids are the real delivery locations
  const assoc = await api("/services/restservice.svc/v4/getDeliveryAssociations", {
    method: "POST",
    body: { cardId: 0, deliveryGroups: [sel(2680)] },
  });
  const alzas = (assoc.json?.data ?? []).filter((a) => a && !a.isHidden);
  console.log("alzaBox associations:", alzas.length, alzas.slice(0, 3).map((a) => a.id));
  const alzaBox = alzas[0];

  const variants = [
    ["A: dEmail+dName+newUserInfo.anonymOrder", { dEmail: EMAIL, dName: "E2E Test", newUserInfo: { anonymOrder: true } }],
    ["B: dEmail+dName only", { dEmail: EMAIL, dName: "E2E Test" }],
    ["C: dEmail+dName+dPhone", { dEmail: EMAIL, dName: "E2E Test", dPhone: "+420 777 000 111" }],
    ["D: dEmail+newUserInfo only", { dEmail: EMAIL, newUserInfo: { anonymOrder: true } }],
  ];

  for (const [label, params] of variants) {
    console.log(`\n--- variant ${label} ---`);
    const s2 = await api("/services/restservice.svc/v7/sendOrder2", { method: "POST", body: { deliveryGroups: [sel(925)], paymentId: 103, paymentCardId: 0, selectedDeliveryOptionId: 925, deliveryName: "24/7 Praha 6 - Dejvice" } });
    if (s2.json?.err) { console.log("sendOrder2 err:", s2.json.err, s2.json?.msg); continue; }
    const s3 = await api("/services/restservice.svc/v5/sendOrder3", { method: "POST", body: { parameters: params } });
    console.log("sendOrder3:", s3.status, "err:", s3.json?.err ?? null, "msg:", s3.json?.msg ?? null, "errors:", JSON.stringify(s3.json?.errors ?? null)?.slice(0, 400));
    if (s3.status === 200 && !s3.json?.err) {
      console.log("  sendOrder3 OK — trying approval + finish");
      const s4 = await api("/services/restservice.svc/v1/approveOrder4");
      console.log("approveOrder4:", s4.status, "errLevel:", s4.json?.ErrorLevel, s4.json?.Message ?? null);
      const fin = await api("/api/orders/v7/orderfinished", { method: "POST", body: { consents: [], basketConsents: [], saveCard: false } });
      console.log("orderfinished:", fin.status, JSON.stringify(fin.json).slice(0, 700));
      if (fin.status === 200) { console.log("VARIANT WORKS:", label); await browser.close(); return; }
    }
  }

  // AlzaBox with association deliveryId
  console.log("\n--- AlzaBox (deliveryId=association " + (alzaBox?.id ?? "?") + ") ---");
  const a2 = await api("/services/restservice.svc/v7/sendOrder2", { method: "POST", body: { deliveryGroups: [sel(alzaBox.id, { parcelShopId: alzaBox.id })], paymentId: 103, paymentCardId: 0, selectedDeliveryOptionId: 2680, deliveryName: "AlzaBox" } });
  console.log("sendOrder2:", a2.status, "err:", a2.json?.err, "msg:", a2.json?.msg ?? null);
  if (!a2.json?.err) {
    const a3 = await api("/services/restservice.svc/v5/sendOrder3", { method: "POST", body: { parameters: { dEmail: EMAIL, dName: "E2E Test", dPhone: "+420 777 000 111", newUserInfo: { anonymOrder: true } } } });
    console.log("sendOrder3:", a3.status, "err:", a3.json?.err ?? null, "msg:", a3.json?.msg ?? null);
    if (!a3.json?.err) {
      const a4 = await api("/services/restservice.svc/v1/approveOrder4");
      console.log("approveOrder4:", a4.status, "errLevel:", a4.json?.ErrorLevel);
      const fin = await api("/api/orders/v7/orderfinished", { method: "POST", body: { consents: [], basketConsents: [], saveCard: false } });
      console.log("orderfinished:", fin.status, JSON.stringify(fin.json).slice(0, 700));
    }
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
