import { describe, expect, it } from "vitest";
import {
  formatAddToCart,
  formatCart,
  formatCheckoutPreview,
  formatOrder,
  formatProfile,
  withConciseText,
} from "../src/tools/account-format.js";

describe("account envelope formatters (concise text channel)", () => {
  it("formatCart: surfaces user binding, totals, and item lines", () => {
    const env = {
      info: {
        err: 0,
        msg: null,
        basket_cnt: 3,
        user_id: 100000001,
        user_name: "",
        email: "e2e-user@example.invalid",
        orderId: 1656647862,
        pricePay: "496 Kč",
        priceVat: "496 Kč",
        vzt: 5681187870867470,
      },
      items: {
        msg: null,
        vouchers_cnt: 0,
        data: [
          { code: "SPTbiwo004", name: "Čistič na kolo BikeWorkx Clean Star 200 ml", count: 1, orderItemId: 1024721313, priceVat: "169 Kč", price: "140 Kč" },
          { code: "HRAif8315", name: "Pexeso Značky aut", count: 1, orderItemId: 1023794550, priceVat: "119 Kč", price: "98 Kč" },
          { code: "FKP0383232", name: "Kniha Srdečný pozdrav plus pexeso", count: 2, orderItemId: 1022932430, priceVat: "70 Kč", price: "70 Kč" },
        ],
      },
    };
    const text = formatCart(env);
    expect(text).toContain("user 100000001");
    expect(text).toContain("3 item line(s)");
    expect(text).toContain("total 496 Kč");
    expect(text).toContain("e2e-user@example.invalid");
    expect(text).toContain("1× Čistič na kolo BikeWorkx Clean Star 200 ml (SPTbiwo004) — 169 Kč");
    expect(text).toContain("2× Kniha Srdečný pozdrav plus pexeso (FKP0383232) — 70 Kč");
    expect(text).toContain("vouchers: 0");
    // high-signal text must be smaller than the raw JSON (real envelopes are ~20KB, where this saves >90%)
    expect(text.length).toBeLessThan(JSON.stringify(env).length);
  });

  it("formatCart: reports err:1 business validation with the Alza message", () => {
    const text = formatCart({ info: { err: 1, msg: "Koš je prázdný." }, items: { data: [] } });
    expect(text).toContain("err:1");
    expect(text).toContain("Koš je prázdný.");
  });

  it("formatCart: tolerates missing/odd shapes without throwing", () => {
    expect(formatCart(null)).toContain("# Alza cart");
    expect(formatCart({ info: "garbage", items: 42 })).toContain("# Alza cart");
    expect(formatCart({})).toContain("# Alza cart");
  });

  it("formatProfile: surfaces account binding + address book pointer", () => {
    const env = {
      err: 0,
      user_id: 100000001,
      user_name: "E2E Test",
      email: "e2e-user@example.invalid",
      deliveryaddress_cnt: 2,
      baskets_cnt: 1,
      vip: false,
      twoFactorAuth: false,
    };
    const text = formatProfile(env);
    expect(text).toContain("user 100000001");
    expect(text).toContain("email: e2e-user@example.invalid");
    expect(text).toContain("delivery addresses: 2");
    expect(text).toContain("address_upsert");
    expect(text).not.toContain("vip: yes");
  });

  it("formatProfile: anonymous shape (user_id -1) is still reported", () => {
    const text = formatProfile({ err: 0, user_id: -1, email: null });
    expect(text).toContain("user -1");
  });

  it("formatAddToCart: surfaces the added line + new basket count", () => {
    const env = {
      err: 0,
      basket_cnt: 3,
      user_id: 100000001,
      data: { code: "SPTbiwo004", name: "Čistič na kolo BikeWorkx Clean Star 200 ml", count: 1, orderItemId: 1024721313 },
      order: { priceToPay: "496 Kč" },
    };
    const text = formatAddToCart(env);
    expect(text).toContain("Čistič na kolo BikeWorkx Clean Star 200 ml (SPTbiwo004) × 1");
    expect(text).toContain("orderItemId: 1024721313");
    expect(text).toContain("cart now holds 3 line(s)");
    expect(text).toContain("cart total: 496 Kč");
  });

  it("formatAddToCart: reports err:1 rejections", () => {
    const text = formatAddToCart({ err: 1, msg: "Zboží již není skladem." });
    expect(text).toContain("err:1");
    expect(text).toContain("Zboží již není skladem.");
  });

  it("formatOrder: surfaces order id/status/total + part pointer", () => {
    const env = {
      order: {
        orderId: 1056808137,
        orderStatus: "Zpracování",
        priceVat: "104 Kč",
        email: "e2e-user@example.invalid",
        parts: [{ partId: "a" }, { partId: "b" }],
      },
    };
    const text = formatOrder(env);
    expect(text).toContain("orderId: 1056808137");
    expect(text).toContain("status: Zpracování");
    expect(text).toContain("total: 104 Kč");
    expect(text).toContain("parts: 2");
  });

  it("formatOrder: tolerates unknown order shapes", () => {
    expect(formatOrder({ order: { weird: true } })).toContain("# Alza order");
    expect(formatOrder(null)).toContain("# Alza order");
  });

  it("formatCheckoutPreview: keeps the confirmation token visible (critical for place_order)", () => {
    const env = {
      cart: { info: { err: 0, basket_cnt: 1, user_id: 100000001, pricePay: "169 Kč" }, items: { data: [{ code: "SPTbiwo004", name: "Clean Star", count: 1, priceVat: "169 Kč" }] } },
      deliveryPaymentGroups: { deliveries: [{ id: 2680 }, { id: 3000 }] },
      checkoutState: { some: "state" },
      confirmationToken: "a1ebc88b3585ab4e" + "f".repeat(32),
    };
    const text = formatCheckoutPreview(env);
    expect(text).toContain("order NOT submitted");
    expect(text).toContain(env.confirmationToken);
    expect(text).toContain("1× Clean Star (SPTbiwo004) — 169 Kč");
    expect(text).toContain("2 delivery option(s)");
  });

  it("withConciseText: falls back to raw JSON if the formatter throws", () => {
    const res = withConciseText({ a: 1 }, () => {
      throw new Error("boom");
    });
    expect(res.content[0].text).toContain('"a": 1');
    expect(res.structuredContent).toEqual({ a: 1 });
  });

  it("withConciseText: always keeps the full envelope in structuredContent", () => {
    const env = { info: { err: 0, basket_cnt: 1 } };
    const res = withConciseText(env, formatCart);
    expect(res.structuredContent).toEqual(env);
  });
});
