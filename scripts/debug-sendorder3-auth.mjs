#!/usr/bin/env node
/**
 * Authenticated sendOrder3 debug: tests user-info payload variants with the
 * APK-serializer field names (top-level `email`, NOT `dEmail`) on both
 * delivery types (branch + AlzaBox). Uses the stored OAuth token.
 * Usage: node scripts/debug-sendorder3-auth.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const BASE = "https://www.alza.cz";
const store = JSON.parse(readFileSync(process.env.ALZA_TOKEN_FILE ?? join(homedir(), ".alza-mcp", "tokens.json"), "utf8"));
const EMAIL = process.env.E2E_EMAIL ?? "e2e-user@example.invalid";
const PRODUCT = process.env.E2E_PRODUCT ?? "CEN178a";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ locale: "cs-CZ", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  for (let i = 0; i < 15; i++) {
    const r = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    if (r && r.status() === 200) break;
    await page.waitForTimeout(3000);
  }
  const api = (path, { method = "GET", body } = {}) =>
    page.evaluate(
      async ({ method, url, body, headers, token, guid }) => {
        const h = {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "Alza/2026.15.0 (Android)",
          "accept-language": "cs-CZ,cs;q=0.9,en;q=0.8",
          "x-correlation-id": crypto.randomUUID(),
          "Balancer-Guid": guid,
          ...headers,
        };
        if (token) h.authorization = `Bearer ${token}`;
        const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), credentials: "include" });
        const text = await res.text();
        let json; try { json = JSON.parse(text); } catch { json = text; }
        return { status: res.status, json };
      },
      { method, url: BASE + path, body, headers: {}, token: store.access_token, guid: store.visitor_id },
    );

  // sanity: authenticated profile
  const me = await api("/services/restservice.svc/v2/getUserData");
  console.log("getUserData:", me.status, "err:", me.json?.err ?? null, "user:", JSON.stringify(me.json?.user_name ?? me.json?.userName ?? null));

  // fresh cart item
  const add = await api("/services/restservice.svc/v2/basket/add", { method: "POST", body: { code: PRODUCT, amount: 1 } });
  console.log("addToCart:", add.status, JSON.stringify(add.json).slice(0, 200));

  // delivery groups
  const num = (v) => (typeof v === "number" ? v : v === undefined || v === null ? undefined : Number(v));
  const groups = await api("/services/restservice.svc/v12/getDeliveryPaymentGroups");
  const all = (groups.json?.deliveryGroups ?? []).flatMap((g) => (g.deliveries ?? []).map((d) => ({ ...d, groupId: num(g.deliveryGroupId ?? g.id), groupName: g.name, groupType: g.deliveryGroupType ?? g.type, optId: num(d.id ?? d.optionId ?? d.deliveryId) })));
  console.log("offered:", all.slice(0, 12).map((d) => `${d.name ?? d.deliveryName ?? "?"}(id=${d.optId},${d.itemType ?? "?"})`).join(" | ").slice(0, 500));
  const box = all.find((d) => d.optId === 2680);
  const branch = all.find((d) => d.itemType === "InPersonBranch" && typeof d.name === "string") ?? all.find((d) => d.optId === 925);
  console.log("box:", box ? `ok (group ${box.groupId})` : "not offered", "| branch:", branch ? `ok (group ${branch.groupId}, ${branch.name})` : "not offered");
  const candidates = [
    box ? { label: "AlzaBox 2680", d: box, parcelShopId: 1128203 } : null,
    branch ? { label: `branch ${branch.name ?? 925}`, d: branch } : null,
  ].filter(Boolean);

  const userInfoVariants = [
    ["A: {}", {}],
    ["B: email", { email: EMAIL }],
    ["C: email+newUserInfo", { email: EMAIL, newUserInfo: { anonymOrder: true, login: EMAIL } }],
  ];

  for (const cand of candidates) {
    const { d } = cand;
    for (const [vlabel, params] of userInfoVariants) {
      console.log(`\n=== ${cand.label} + sendOrder3 ${vlabel} ===`);
      const s1 = await api("/services/restservice.svc/v4/sendOrder1");
      console.log("sendOrder1:", s1.status, "err:", s1.json?.err ?? null, "msg:", s1.json?.msg ?? null);
      if (s1.status !== 200 || (s1.json?.err ?? 0) !== 0) continue;
      const s2 = await api("/services/restservice.svc/v7/sendOrder2", {
        method: "POST",
        body: {
          selectedDeliveryOptionId: d.optId,
          paymentId: 103,
          paymentCardId: 0,
          deliveryGroups: [{
            deliveryGroupId: d.groupId,
            deliveryId: d.optId,
            deliveryServicesIds: [],
            parcelShopId: cand.parcelShopId ?? 0,
            timeFrameId: 0,
            timeSlotId: 0,
          }],
        },
      });
      console.log("sendOrder2:", s2.status, "err:", s2.json?.err ?? null, "msg:", s2.json?.msg ?? null);
      if (s2.status !== 200 || (s2.json?.err ?? 0) !== 0) continue;
      const s3 = await api("/services/restservice.svc/v5/sendOrder3", { method: "POST", body: { parameters: params } });
      console.log("sendOrder3:", s3.status, "err:", s3.json?.err ?? null, "msg:", s3.json?.msg ?? null, "errors:", JSON.stringify(s3.json?.errors ?? null)?.slice(0, 300));
      if (s3.status === 200 && (s3.json?.err ?? 1) === 0) {
        const a4 = await api("/services/restservice.svc/v1/approveOrder4");
        console.log("approveOrder4:", a4.status, "err:", a4.json?.err ?? null, "msg:", a4.json?.msg ?? null);
        const fin = await api("/api/orders/v7/orderfinished", { method: "POST", body: { consents: [], basketConsents: [], saveCard: false } });
        console.log("orderfinished:", fin.status, JSON.stringify(fin.json).slice(0, 400));
        console.log("SUCCESS-AT", cand.label, vlabel);
        await browser.close();
        process.exit(0);
      }
    }
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
