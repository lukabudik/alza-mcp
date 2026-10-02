import { describe, expect, it } from "vitest";
import { MobileApi } from "../src/infra/mobile-api.js";
import { MobileAccount } from "../src/domain/mobile-account.js";

// Keep unit tests deterministic: never auto-load a real stored OAuth token.
process.env.ALZA_TOKEN_FILE = "none";

describe("mobile API account", () => {
  it("uses a persistent anonymous visitor id and mobile headers", () => {
    const api = new MobileApi({ visitorId: "visitor-test" });
    expect(api.visitorId).toBe("visitor-test");
    expect(api.isAuthenticated).toBe(false);
  });

  it("rejects invalid cart quantities before making a request", async () => {
    const account = new MobileAccount(new MobileApi({ visitorId: "visitor-test" }));
    await expect(account.addToCart("ABC", 0)).rejects.toThrow(/quantity/);
    await expect(account.addToCart("ABC", 100)).rejects.toThrow(/quantity/);
  });

  it("rejects arbitrary order confirmation tokens", async () => {
    const account = new MobileAccount(new MobileApi({ visitorId: "visitor-test" }));
    await expect(account.submitOrder("x".repeat(32), {}, {}, {})).rejects.toThrow(/confirmation token/);
  });

  it("sends the APK-embedded client_secret on OAuth token requests (overridable/omittable)", async () => {
    const requests: { url: string; body: string }[] = [];
    const previous = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify({ token_endpoint: "https://identity.test/connect/token" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      requests.push({ url, body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const prevSecret = process.env.ALZA_OAUTH_CLIENT_SECRET;
    try {
      // default: the APK-embedded confidential-client secret is included
      const api = new MobileApi({ visitorId: "visitor-test" });
      (api as unknown as { refreshToken: string }).refreshToken = "test-rt";
      await expect(api.refreshAccessToken()).resolves.toBe(true);
      expect(requests.at(-1)?.body).toContain("client_secret=ZRtjXCjaYFmUbGNvbTK25uctj4nQRT6a");

      // explicit override wins
      process.env.ALZA_OAUTH_CLIENT_SECRET = "custom-secret";
      const api2 = new MobileApi({ visitorId: "visitor-test" });
      (api2 as unknown as { refreshToken: string }).refreshToken = "test-rt";
      await api2.refreshAccessToken();
      expect(requests.at(-1)?.body).toContain("client_secret=custom-secret");

      // empty env value omits the parameter (public clients)
      process.env.ALZA_OAUTH_CLIENT_SECRET = "";
      const api3 = new MobileApi({ visitorId: "visitor-test" });
      (api3 as unknown as { refreshToken: string }).refreshToken = "test-rt";
      await api3.refreshAccessToken();
      expect(requests.at(-1)?.body).not.toContain("client_secret");
    } finally {
      globalThis.fetch = previous;
      if (prevSecret === undefined) delete process.env.ALZA_OAUTH_CLIENT_SECRET;
      else process.env.ALZA_OAUTH_CLIENT_SECRET = prevSecret;
    }
  });

  it("requires a matching one-time token for list mutations", async () => {
    const account = new MobileAccount(new MobileApi({ visitorId: "visitor-test" }));
    const prepared = account.prepareMutation("create");
    await expect(account.mutateList("rename", prepared.confirmationToken, { id: 1, name: "x" })).rejects.toThrow(/mutation confirmation token/);
  });

  it("sends exact DTO field names for mobile parity endpoints", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const previous = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.url = String(input); seen.init = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const api = new MobileApi({ visitorId: "visitor-test", baseUrl: "https://example.test" });
      await api.urlInfo("/foo");
      expect(seen.url).toBe("https://example.test/api/catalog/v1/homePage/getUrlInfo");
      expect(JSON.parse(String(seen.init?.body))).toEqual({ url: "/foo" });
      await api.branches(50.087, 14.421);
      expect(seen.url).toContain("/api/branches/v1/cityBranches?latitude=50.087&longitude=14.421");
      await api.productsByEan(["123"]);
      expect(JSON.parse(String(seen.init?.body))).toEqual({ eanList: ["123"] });
      await api.commodityLists(3);
      expect(seen.url).toContain("/services/restservice.svc/v1/getCommodityLists?type=3");
      await api.catalogUserNavigation();
      expect(seen.url).toContain("/api/catalog/v2/homePage/userNavigation");
      await api.category(7, "CATEGORY", 2);
      // live correction 2026-09-09: the server binds T and P (type/typeId → 400)
      expect(seen.url).toContain("/services/restservice.svc/v1/category/7?T=CATEGORY&P=2");
      await api.updateBasket(11, true, true);
      expect(seen.url).toContain("/services/restservice.svc/v2/updBasket/11/1?isDelayedPayment=true");
      // A no-body GET may be represented as undefined or null (the CF transport normalises to null).
      expect(seen.init?.body ?? undefined).toBeUndefined();
      await api.orderAddInfo();
      expect(seen.url).toContain("/services/restservice.svc/v2/getOrderAddInfo?isGiftsEnabled=true");
      await api.discussionPosts(12, 25, { showOnlyWithoutAnswer: true });
      expect(seen.url).toContain("/services/restservice.svc/v1/getCommodityDiscussionPosts?id=12&pageStart=25&pageSize=25");
      await api.register({ email: "a@b.cz", phone: "+4201", pwd: "secret123", code: "123456" });
      expect(seen.url).toBe("https://example.test/services/restservice.svc/v2/CreateUser");
      expect(JSON.parse(String(seen.init?.body))).toEqual({ email: "a@b.cz", phone: "+4201", pwd: "secret123", code: "123456" });
      await api.afterOrderPayment({ id: "O1", invoiceNumber: "I1", paymentId: 7, cardId: 3 });
      expect(seen.url).toBe("https://example.test/api/orders/v4/afterOrderPayment");
      expect(JSON.parse(String(seen.init?.body))).toEqual({ id: "O1", invoiceNumber: "I1", paymentId: 7, cardId: 3 });
      await api.eanLookup(["859"]);
      expect(seen.url).toBe("https://example.test/services/restservice.svc/v1/getProductByEANlist");
    } finally { globalThis.fetch = previous; }
  });
});

describe("typed user-management, payment, and order tools", () => {
  const makeAccount = () => new MobileAccount(new MobileApi({ visitorId: "visitor-test", baseUrl: "https://test.alza.invalid" }));
  const mockFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
    const previous = globalThis.fetch;
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init);
    }) as typeof fetch;
    return { calls, restore: () => { globalThis.fetch = previous; } };
  };
  const action = (href = "/services/restservice.svc/v1/addressForm", rel: string[] = ["form"]) => ({
    form: { meta: { href, method: "POST", rel }, values: [{ name: "serverField", value: "from-server", kind: "text" }] },
  });
  const json = (body: unknown) => new Response(JSON.stringify(body ?? { ok: true }), { status: 200, headers: { "content-type": "application/json" } });

  it("accepts every registered mutation action and rejects unknown ones", () => {
    const account = makeAccount();
    for (const op of ["create", "coupon_add", "basket_update", "basket_unlock", "after_order_payment", "register", "address_create", "address_edit", "address_delete", "review_submit", "subscription_activate", "subscription_update_installment", "attachment_upload"]) {
      expect(() => account.prepareMutation(op)).not.toThrow();
    }
    expect(() => account.prepareMutation("nope")).toThrow(/Unknown mutation action/);
  });

  it("guards registration with the one-time token and typed Register DTO validation", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => json());
    try {
      const prepared = account.prepareMutation("register");
      await expect(account.register({ email: "a@b.cz", phone: "+420123456789", pwd: "secret123" }, "x".repeat(32))).rejects.toThrow(/register confirmation token/);
      const fresh = account.prepareMutation("register");
      await expect(account.register({ email: "not-an-email", phone: "+420123456789", pwd: "secret123" }, fresh.confirmationToken)).rejects.toThrow(/email/);
      const shortPwd = account.prepareMutation("register");
      await expect(account.register({ email: "a@b.cz", phone: "+420123456789", pwd: "12345" }, shortPwd.confirmationToken)).rejects.toThrow(/pwd/);
      const ok = account.prepareMutation("register");
      await account.register({ email: "a@b.cz", phone: "+420123456789", pwd: "secret123", code: "123456" }, ok.confirmationToken);
      expect(calls[0].url).toBe("https://test.alza.invalid/services/restservice.svc/v2/CreateUser");
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: "a@b.cz", phone: "+420123456789", pwd: "secret123", code: "123456" });
    } finally { restore(); }
  });

  it("merges typed address fields into the server-provided form action", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => json());
    try {
      const badZip = account.prepareMutation("address_create");
      await expect(account.addressUpsert("create", action(), { name: "J", street: "A 1", city: "Praha", zip_code: "12345678901" }, badZip.confirmationToken)).rejects.toThrow(/zip_code/);
      const badType = account.prepareMutation("address_create");
      await expect(account.addressUpsert("create", action(), { name: "J", street: "A 1", city: "Praha", zip_code: "11000", address_type: "HOME2" }, badType.confirmationToken)).rejects.toThrow(/address_type/);
      const ok = account.prepareMutation("address_create");
      await account.addressUpsert("create", action(), { name: "J", street: "A 1", city: "Praha", zip_code: "110 00", address_type: "WORK", firm: "F" }, ok.confirmationToken);
      const body = JSON.parse(String(calls.at(-1)?.init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ name: "J", street: "A 1", city: "Praha", zipCode: "110 00", addressType: "WORK", firm: "F", serverField: "from-server", visitorId: "visitor-test" });
      const edit = account.prepareMutation("address_edit");
      await account.addressUpsert("edit", action(), { name: "J", street: "A 1", city: "Praha", zip_code: "110 00", address_id: 9 }, edit.confirmationToken);
      expect((JSON.parse(String(calls.at(-1)?.init?.body)) as Record<string, unknown>).id).toBe(9);
      const del = account.prepareMutation("address_delete");
      await account.addressDelete(action(), { address_id: 4 }, del.confirmationToken);
      expect((JSON.parse(String(calls.at(-1)?.init?.body)) as Record<string, unknown>).id).toBe(4);
    } finally { restore(); }
  });

  it("treats address search as a token-free GET action", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => json());
    const searchAction = { form: { meta: { href: "/api/users/1/addresses/search", method: "GET" }, values: [] } };
    try {
      await account.addressSearch(searchAction, "110 00");
      const url = new URL(calls[0].url);
      expect(url.searchParams.get("search")).toBe("110 00");
      expect(url.searchParams.get("visitorId")).toBe("visitor-test");
      await expect(account.addressSearch(searchAction, "")).rejects.toThrow(/query/);
    } finally { restore(); }
  });

  it("projects payment methods from the delivery-payment-group response", async () => {
    const account = makeAccount();
    const { restore } = mockFetch(() => json({ payments: [{ id: 1 }], paymentTip: "tip", warnings: ["w"], deliveryGroups: [] }));
    try {
      const out = await account.paymentMethods() as { payments: unknown[]; paymentTip: string; warnings: string[] };
      expect(out).toEqual({ payments: [{ id: 1 }], paymentTip: "tip", warnings: ["w"] });
      await expect(account.paymentMethods(0)).rejects.toThrow(/selected_delivery_option_id/);
    } finally { restore(); }
  });

  it("validates after-order payment inputs and sends the APK AfterOrderRequestBody", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => json());
    try {
      await expect(account.afterOrderPayments("", "p1")).rejects.toThrow(/order_id/);
      const bad = account.prepareMutation("after_order_payment");
      await expect(account.payAfterOrder({ order_id: "O1", invoice_number: "I1", payment_id: 1.5 }, bad.confirmationToken)).rejects.toThrow(/payment_id/);
      const ok = account.prepareMutation("after_order_payment");
      const result = await account.payAfterOrder({ order_id: "O1", invoice_number: "I1", paymentId: undefined as never, payment_id: 7, card_id: 3 }, ok.confirmationToken);
      expect(calls[0].url).toBe("https://test.alza.invalid/api/orders/v4/afterOrderPayment");
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({ id: "O1", invoiceNumber: "I1", paymentId: 7, cardId: 3, deviceFingerprint: undefined });
      expect(result).toBeDefined();
    } finally { restore(); }
  });

  it("reads an order plus optional part detail with flag validation", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch((url) => json(url.includes("/api/v1/orders/") ? { part: true } : { order: true }));
    try {
      await expect(account.order("O1", undefined, 2)).rejects.toThrow(/user_flag/);
      const out = await account.order("O1", "P1", 0, true) as { order: unknown; part: unknown };
      expect(out.order).toEqual({ order: true });
      expect(out.part).toEqual({ part: true });
      expect(calls[0].url).toContain("/api/users/0/v1/orders/O1?initialCreated=1");
      expect(calls[1].url).toBe("https://test.alza.invalid/api/v1/orders/O1/P1");
    } finally { restore(); }
  });

  it("validates review submissions and complaint/subscription action shapes", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => json());
    try {
      const bad = account.prepareMutation("review_submit");
      await expect(account.reviewSubmit(action(), { rating: 6 }, bad.confirmationToken)).rejects.toThrow(/rating/);
      const ok = account.prepareMutation("review_submit");
      await account.reviewSubmit(action(), { rating: 5, text: "super", values: [{ name: "pro", value: "great", kind: "text" }] }, ok.confirmationToken);
      const body = JSON.parse(String(calls.at(-1)?.init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ rating: 5, text: "super", pro: "great" });
      await expect(account.complaintClaims({ form: { meta: {} } })).rejects.toThrow(/form\.meta\.href/);
      const sub = account.prepareMutation("subscription_activate");
      await account.subscriptionActivate(action("/api/subscription/activate"), { values: [{ name: "installmentCount", value: 3, kind: "integer" }] }, sub.confirmationToken);
      expect((JSON.parse(String(calls.at(-1)?.init?.body)) as Record<string, unknown>).installmentCount).toBe(3);
    } finally { restore(); }
  });

  it("uploads attachments as multipart parts with MIME and size limits", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => new Response("{}", { status: 200 }));
    try {
      const none = account.prepareMutation("attachment_upload");
      await expect(account.uploadAttachment(action(), { files: [] }, none.confirmationToken)).rejects.toThrow(/files/);
      const notMultipart = account.prepareMutation("attachment_upload");
      await expect(account.uploadAttachment(action(), { files: [{ part_name: "attachments", file_name: "a.jpg", mime_type: "image/jpeg", data_url: "data:image/jpeg;base64,AAA=" }] }, notMultipart.confirmationToken)).rejects.toThrow(/multipart/);
      const badMime = account.prepareMutation("attachment_upload");
      const multipart = (rel: string[] = ["multipart"]) => ({ form: { meta: { href: "/api/complaints/1/attachments", method: "POST", rel }, values: [] } });
      await expect(account.uploadAttachment(multipart(), { files: [{ part_name: "attachments", file_name: "a.bin", mime_type: "application/pdf", data_url: "data:application/pdf;base64,AAA=" }] }, badMime.confirmationToken)).rejects.toThrow(/MIME/);
      const ok = account.prepareMutation("attachment_upload");
      await account.uploadAttachment(multipart(), { files: [{ part_name: "attachments", file_name: "a.jpg", mime_type: "image/jpeg", data_url: "data:image/jpeg;base64," + Buffer.from("hello").toString("base64") }] }, ok.confirmationToken);
      const body = calls.at(-1)?.init?.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      const filePart = body.get("attachments");
      expect(filePart).toBeInstanceOf(File);
      expect((filePart as File).name).toBe("a.jpg");
      expect((filePart as File).type).toBe("image/jpeg");
      expect(body.get("visitorId")).toBe("visitor-test");
    } finally { restore(); }
  });

  it("extends the read whitelist and the low-risk mutation whitelist", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => json());
    try {
      await account.read("search", { search_term: "notebook", page: 2 });
      expect(calls.at(-1)?.url).toBe("https://test.alza.invalid/services/restservice.svc/v5/search");
      await account.read("category", { category_id: 7 });
      // live correction 2026-09-09: T/P query fields (type/typeId → HTTP 400)
      expect(calls.at(-1)?.url).toBe("https://test.alza.invalid/services/restservice.svc/v1/category/7?T=CATEGORY&P=0");
      await account.read("order2_info", {});
      // live correction 2026-09-09: requestModel.Country is required
      expect(calls.at(-1)?.url).toBe("https://test.alza.invalid/services/restservice.svc/v8/getOrder2Info?country=CZ");
      await expect(account.read("ean_lookup", { ean_list: [] })).rejects.toThrow(/ean_list/);
      await account.read("ean_lookup", { ean_list: ["859"] });
      expect(calls.at(-1)?.url).toContain("/services/restservice.svc/v1/getProductByEANlist");
      await account.read("cost_estimate", { productIds: [1] });
      expect(calls.at(-1)?.url).toBe("https://test.alza.invalid/api/orders/v1/costEstimate");
      await account.read("basket_info");
      expect(calls.at(-1)?.url).toContain("/services/restservice.svc/v3/basketInfo");
      const coupon = account.prepareMutation("coupon_add");
      await account.mutateList("coupon_add", coupon.confirmationToken, { coupon: "SAVE10" });
      expect(calls.at(-1)?.url).toContain("/services/restservice.svc/v1/addcoupon/SAVE10");
      const basket = account.prepareMutation("basket_update");
      await account.mutateList("basket_update", basket.confirmationToken, { basket_id: 5, flag: true, is_delayed_payment: true });
      expect(calls.at(-1)?.url).toContain("/services/restservice.svc/v2/updBasket/5/1?isDelayedPayment=true");
      const unlock = account.prepareMutation("basket_unlock");
      await account.mutateList("basket_unlock", unlock.confirmationToken, {});
      // live correction 2026-09-09: GET + required Country query field
      expect(calls.at(-1)?.url).toContain("/services/restservice.svc/v1/unlockbasket?country=CZ");
      // live corrections 2026-09-10 (rows R1/B7/O9): server-provided routes + Int32 bindings
      await account.read("user_review", { commodity_id: 5303618 });
      expect(calls.at(-1)?.url).toBe("https://webapi.alza.cz/api/catalog/commodities/5303618/reviews?country=CZ&limit=5");
      await account.read("user_navigation", { user_id: 100000001, eshop_url: "www.alza.cz" });
      expect(calls.at(-1)?.url).toBe("https://webapi.alza.cz/api/users/100000001/mainNavigation?country=CZ&eshopUrl=www.alza.cz");
      await account.read("visitor_navigation", {});
      expect(calls.at(-1)?.url).toBe("https://webapi.alza.cz/api/visitors/visitor-test/mainNavigation?country=CZ");
      const rm = account.prepareMutation("coupon_remove");
      await account.mutateList("coupon_remove", rm.confirmationToken, { couponId: 123 });
      expect(calls.at(-1)?.url).toContain("/services/restservice.svc/v1/delcoupon/123");
      await expect(account.mutateList("coupon_remove", account.prepareMutation("coupon_remove").confirmationToken, { couponId: "SAVE10" })).rejects.toThrow(/couponId/);
      const svc = account.prepareMutation("add_order_service");
      await account.mutateList("add_order_service", svc.confirmationToken, { orderItemId: 456, enabled: true, selected: false });
      expect(calls.at(-1)?.url).toContain("/services/restservice.svc/v1/addOrderService/456/1/0");
      const typedOnly = account.prepareMutation("register");
      await expect(account.mutateList("register", typedOnly.confirmationToken, { email: "a@b.cz", phone: "+4201", pwd: "secret123" })).rejects.toThrow(/not a whitelisted low-risk mutation/);
    } finally { restore(); }
  });
});

describe("web checkout family (gap-analysis G1/G2/G3, 2026-09-08)", () => {
  const makeAccount = () => new MobileAccount(new MobileApi({ visitorId: "visitor-test", baseUrl: "https://test.alza.invalid" }));
  const mockFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
    const previous = globalThis.fetch;
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init);
    }) as typeof fetch;
    return { calls, restore: () => { globalThis.fetch = previous; } };
  };
  const wcf = (body: unknown) => new Response(JSON.stringify({ d: body }), { status: 200, headers: { "content-type": "application/json" } });

  it("G2: uses getDeliveryPaymentGroups v13 and falls back to v12 on 404 only", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch((url) => url.includes("/v13/getDeliveryPaymentGroups")
      ? new Response(JSON.stringify({ v13: true }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ v12: true }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await expect(account.deliveryOptions()).resolves.toEqual({ v13: true });
      expect(calls[0].url).toContain("/services/restservice.svc/v13/getDeliveryPaymentGroups");
      expect(calls).toHaveLength(1);
    } finally { restore(); }

    const fallback = mockFetch((url) => url.includes("/v13/getDeliveryPaymentGroups")
      ? new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ v12: true }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await expect(account.deliveryOptions()).resolves.toEqual({ v12: true });
      expect(fallback.calls.map((c) => c.url)).toEqual([
        "https://test.alza.invalid/services/restservice.svc/v13/getDeliveryPaymentGroups",
        "https://test.alza.invalid/services/restservice.svc/v12/getDeliveryPaymentGroups",
      ]);
    } finally { fallback.restore(); }

    const noFallback = mockFetch((url) => url.includes("/v13/getDeliveryPaymentGroups")
      ? new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "content-type": "application/json" } })
      : new Response("should not be called", { status: 200 }));
    try {
      await expect(account.deliveryOptions()).rejects.toThrow(/HTTP 500/);
      expect(noFallback.calls).toHaveLength(1);
    } finally { noFallback.restore(); }
  });

  it("G3: validates web pickup inputs and hits the personalPickup/v1 routes", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await expect(account.webPickupPlaces({ latitude: 95 })).rejects.toThrow(/latitude/);
      await expect(account.webPickupPlaces({ longitude: -181 })).rejects.toThrow(/longitude/);
      await expect(account.webPickupPlaces({ types: [1, 0] })).rejects.toThrow(/types/);
      await expect(account.webPickupPlaces({ limit: 101 })).rejects.toThrow(/limit/);
      await expect(account.webPickupPlaces({ offset: -1 })).rejects.toThrow(/offset/);
      await expect(account.webPickupPlaces({ place_id: 0 })).rejects.toThrow(/place_id/);
      const out = await account.webPickupPlaces({ order_id: 1656778455, group_id: 393772474, latitude: 50.1986, longitude: 15.7626, types: [1, 2], limit: 20, offset: 0, place_id: 601 }) as { form: unknown; places: unknown; detail: unknown };
      expect(out).toEqual({ form: { ok: true }, places: { ok: true }, detail: { ok: true } });
      const urls = calls.map((c) => c.url);
      expect(urls[0]).toBe("https://test.alza.invalid/api/personalPickup/v1/pickupPlaceForm?orderId=1656778455&groupId=393772474&latitude=50.1986&longitude=15.7626");
      expect(urls[1]).toBe("https://test.alza.invalid/api/personalPickup/v1/places?types%5B0%5D=1&types%5B1%5D=2&latitude=50.1986&longitude=15.7626&orderId=1656778455&groupId=393772474&limit=20&offset=0");
      expect(urls[2]).toBe("https://test.alza.invalid/api/personalPickup/v1/places/601?orderId=1656778455&groupId=393772474");
    } finally { restore(); }
  });

  it("G1: runs the web WCF order chain with the 113-gate retry and returns the created order", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch((url) => {
      if (url.includes("/SaveAndConfirmOrder2")) {
        return accountState.confirmCalls++ === 0
          ? wcf({ ErrorLevel: 113, Message: "AlzaPlus gate", alzaPlusPopupDialogAction: { form: {} } })
          : wcf({ ErrorLevel: 0 });
      }
      if (url.includes("/SendOrder4")) {
        // live shape (2026-09-08): top-level OrderId is 0; the created order id
        // lives in GetOrderDetailAction — the tool must derive it from the webLink.
        return wcf({ ErrorLevel: 0, OrderId: 0, GetOrderDetailAction: { webLink: "https://www.alza.cz/my-account/order-details-1056899001.htm?x=HASH123", href: "https://test.alza.invalid/api/anonymous/v1/orders/1056899001?country=CZ" } });
      }
      return wcf({ ErrorLevel: 0 });
    });
    const accountState: { confirmCalls: number } = { confirmCalls: 0 };
    try {
      const prepared = account.prepareMutation("web_place_order");
      await expect(account.webPlaceOrder({ delivery_id: 2680 }, prepared.confirmationToken)).rejects.toThrow(/payment_id/);
      const ok = account.prepareMutation("web_place_order");
      const out = await account.webPlaceOrder({
        delivery_id: 2680, delivery_group_id: 393417625, parcel_shop_id: "1128203", payment_id: 103,
        name: "E2E Test", street: "Example Street 2", city: "Hradec Králové", zip_code: "50004",
        phone: "+420601234567", email: "e2e-user@example.invalid",
        user_consents: [{ consent_id: "2", value: false }],
      }, ok.confirmationToken) as { order_id: number | undefined; order_detail_link: string | undefined; error_levels: Record<string, number> };
      // OrderId:0 in the live response → derived from the GetOrderDetailAction webLink
      expect(out.order_id).toBe(1056899001);
      expect(out.order_detail_link).toBe("https://www.alza.cz/my-account/order-details-1056899001.htm?x=HASH123");
      expect(out.error_levels).toEqual({ SaveOrder2: 0, SaveOrder3: 0, SaveAndConfirmOrder2: 0, CheckOrder4: 0, SendOrder4: 0 });
      // SaveAndConfirmOrder2 was called twice (113 gate + retry)
      expect(calls.filter((c) => c.url.includes("/SaveAndConfirmOrder2"))).toHaveLength(2);
      const save2Body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
      expect(save2Body).toMatchObject({
        selectedDeliveriesForGroups: [{ deliveryGroupId: 393417625, deliveryId: 2680, parcelShopId: "1128203", deliveryAccesoriesIds: [] }],
        paymentId: 103, paymentCardId: 0, alzaPlusSubscriptionId: 0, cetelemLeasingId: 0,
      });
      const save3Body = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>;
      expect(save3Body).toMatchObject({ registerUser: false, login: "e2e-user@example.invalid", name: "E2E Test", street: "Example Street 2", city: "Hradec Králové", zip: "50004", phone: "+420601234567", email: "e2e-user@example.invalid", countryId: 0 });
      const send4Body = JSON.parse(String(calls.at(-1)?.init?.body)) as Record<string, unknown>;
      expect(send4Body).toMatchObject({ quotation: false, internalDescription: "", verificationId: null, verificationCode: null, userConsents: [{ consentId: "2", value: false }], basketConsents: [] });
      // the token is single-use
      await expect(account.webPlaceOrder({ delivery_id: 2680, payment_id: 103, name: "n", street: "s", city: "c", zip_code: "50001", phone: "+420601234567", email: "a@b.cz" }, ok.confirmationToken)).rejects.toThrow(/web_place_order confirmation token/);
    } finally { restore(); }
  });

  it("G1: fails the web WCF chain on a non-zero step ErrorLevel (no silent retry)", async () => {
    const account = makeAccount();
    const { restore } = mockFetch((url) => url.includes("/SaveOrder3")
      ? wcf({ ErrorLevel: 2, Message: "Neplatná objednávka" })
      : wcf({ ErrorLevel: 0 }));
    try {
      const bad = account.prepareMutation("web_place_order");
      await expect(account.webPlaceOrder({
        delivery_id: 2680, payment_id: 103, name: "n", street: "s", city: "c", zip_code: "50001",
        phone: "+420601234567", email: "a@b.cz",
      }, bad.confirmationToken)).rejects.toThrow(/SaveOrder3 failed with ErrorLevel 2/);
    } finally { restore(); }
  });

  it("OR11: reads the cancelForm then PUTs the cancellation, gated by a one-time token", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch((url) =>
      url.includes("/cancelForm")
        ? new Response(JSON.stringify({ method: "PUT", value: [{ name: "reason" }, { name: "submit" }] }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(null, { status: 202 })
    );
    try {
      await expect(account.cancelOrder("1060090910", "HASH123", "1083569825", 0, "bad-token")).rejects.toThrow(/confirmation token/);

      const ok = account.prepareMutation("cancel_order");
      const out = await account.cancelOrder("1060090910", "HASH123", "1083569825", 1, ok.confirmationToken) as { accepted: boolean; order_id: string; part_id: string; reason: number };
      expect(out).toEqual({ accepted: true, order_id: "1060090910", part_id: "1083569825", reason: 1 });
      expect(calls[0].url).toBe("https://test.alza.invalid/api/v1/orders/1060090910/HASH123/parts/1083569825/cancelForm");
      expect(calls[1].url).toBe("https://test.alza.invalid/api/v1/orders/1060090910/HASH123/parts/1083569825/cancellations");
      expect(calls[1].init?.method).toBe("PUT");
      expect(JSON.parse(String(calls[1].init?.body))).toEqual({ value: [{ name: "reason", value: "1" }, { name: "submit" }] });

      // the token is single-use
      await expect(account.cancelOrder("1060090910", "HASH123", "1083569825", 0, ok.confirmationToken)).rejects.toThrow(/confirmation token/);
    } finally { restore(); }
  });

  it("OR11: rejects an out-of-range reason before making any request", async () => {
    const account = makeAccount();
    const ok = account.prepareMutation("cancel_order");
    await expect(account.cancelOrder("1060090910", "HASH123", "1083569825", 6, ok.confirmationToken)).rejects.toThrow(/reason must be/);
  });

  it("anonymous fallback (live-verified 2026-09-26): add_to_cart and delivery_options succeed with no access token and no authorization header sent", async () => {
    const account = makeAccount();
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const { calls, restore } = mockFetch((url) =>
      url.includes("/basket/add")
        ? json({ err: 0, basket_cnt: 1 })
        : json({ deliveryGroups: [{ deliveryGroupId: 398327444, deliveries: [] }] })
    );
    try {
      const add = await account.addToCart("WK060a1l56", 1) as { err: number };
      expect(add.err).toBe(0);
      const del = await account.deliveryOptions() as { deliveryGroups: unknown[] };
      expect(del.deliveryGroups).toHaveLength(1);
      for (const call of calls) {
        const headers = call.init?.headers as Record<string, string> | Headers | undefined;
        const hasAuth = headers instanceof Headers ? headers.has("authorization") : Boolean(headers && "authorization" in headers);
        expect(hasAuth).toBe(false);
      }
    } finally { restore(); }
  });

  it("G1: web after-order payment validates inputs and sends the CreateAfterPayment body", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => wcf({ ErrorLevel: 0, Value: "https://login.kb.cz/login?sso=MojePlatba-1189" }));
    try {
      const bad = account.prepareMutation("web_after_order_payment");
      await expect(account.webAfterOrderPayment({ order_id: "1056808137" }, bad.confirmationToken)).rejects.toThrow(/payment_id/);
      const ok = account.prepareMutation("web_after_order_payment");
      const out = await account.webAfterOrderPayment({ order_id: "1056808137", payment_id: 144, order_hash: "0EABE9WA68A897B38MB71BBFCAA3", price: 104 }, ok.confirmationToken) as Record<string, unknown>;
      expect(out).toMatchObject({ Value: "https://login.kb.cz/login?sso=MojePlatba-1189" });
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({
        orderId: "1056808137", paymentId: 144, hash: "0EABE9WA68A897B38MB71BBFCAA3", enableAD: false,
        invoiceId: "0", price: 104, smsCode: null, smsId: 0, isTrusted: false,
        amountToPay: 104, headerId: null, orderPaymentId: "0",
      });
    } finally { restore(); }
  });

  it("G1: the web after-payment dialog is a token-free WCF read", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => wcf({ Value: "dialog-html" }));
    try {
      await expect(account.webAfterPaymentDialog("")).rejects.toThrow(/order_id/);
      const out = await account.read("web_after_payment_dialog", { order_id: "1056808137", order_hash: "HASH" }) as Record<string, unknown>;
      expect(out).toEqual({ Value: "dialog-html" });
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({ orderId: "1056808137", invoiceId: null, price: null, isPartialPay: false, isSwitchToCashAvailable: false, orderHash: "HASH" });
      expect(calls[0].url).toBe("https://test.alza.invalid/Services/EShopService.svc/GetAfterPaymentDialog");
    } finally { restore(); }
  });

  it("G4: web add-to-cart validates inputs, posts the HATEOAS body and extracts the basket id", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => new Response(JSON.stringify({
      crossPopupAction: { webLink: "https://www.alza.cz/order/1656899450/item/1023695032", form: {} },
      updateAction: { form: { id: 1023695032, count: 1 } }, gtmData: {},
    }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await expect(account.webAddToCart({ commodity_id: 0 })).rejects.toThrow(/commodity_id/);
      await expect(account.webAddToCart({ commodity_id: 7229946, count: 0 })).rejects.toThrow(/count/);
      await expect(account.webAddToCart({ commodity_id: 7229946, count: 100 })).rejects.toThrow(/count/);
      const out = await account.webAddToCart({ commodity_id: 7229946, count: 2 }) as { basket_id: number; item_id: number; response: Record<string, unknown> };
      expect(out.basket_id).toBe(1656899450);
      expect(out.item_id).toBe(1023695032);
      expect(out.response).toHaveProperty("updateAction");
      expect(calls[0].url).toBe("https://test.alza.invalid/api/basket/v1/items");
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({ items: [{ commodityId: 7229946, count: 2 }] });
    } finally { restore(); }
  });

  it("G4: web cart read requires a basket id and hits the cart + items routes", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await expect(account.webCart(0)).rejects.toThrow(/basket_id/);
      await expect(account.webCart(1.5)).rejects.toThrow(/basket_id/);
      const out = await account.webCart(1656899450) as { cart: unknown; items: unknown };
      expect(out).toEqual({ cart: { ok: true }, items: { ok: true } });
      expect(calls.map((c) => c.url)).toEqual([
        "https://test.alza.invalid/api/v1/visitors/visitor-test/baskets/1656899450/checkout/cart?country=CZ",
        "https://test.alza.invalid/api/v1/anonymous/baskets/1656899450/checkout/cart/items?country=CZ",
      ]);
    } finally { restore(); }
  });

  it("C12: home_categories hits the resolved carousel route with the pgri/ui params", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => new Response(JSON.stringify({ self: { appLink: "catalogLocalTitlePage" }, value: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await expect(account.read("home_categories", { category_id: 0 })).rejects.toThrow(/category_id/);
      await expect(account.read("home_categories", { category_id: 1, pgri: "" })).rejects.toThrow(/pgri/);
      await account.read("home_categories", {}) as unknown;
      await account.read("home_categories", { category_id: 1, pgri: "p__26752", ui: "u__401f1" }) as unknown;
      expect(calls.map((c) => c.url)).toEqual([
        "https://test.alza.invalid/api/catalog/v1/homePage/categories/1",
        "https://test.alza.invalid/api/catalog/v1/homePage/categories/1?pgri=p__26752&ui=u__401f1",
      ]);
    } finally { restore(); }
  });
});

describe("P2 candidates implemented as typed tools (2026-09-09)", () => {
  const makeAccount = () => new MobileAccount(new MobileApi({ visitorId: "visitor-test", baseUrl: "https://test.alza.invalid" }));
  const mockFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
    const previous = globalThis.fetch;
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init);
    }) as typeof fetch;
    return { calls, restore: () => { globalThis.fetch = previous; } };
  };
  const json = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  const wcf = (body: unknown) => new Response(JSON.stringify({ d: body }), { status: 200, headers: { "content-type": "application/json" } });

  it("chat_navigation: validates country and hits the cross-host chatbotapi route", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => json());
    try {
      await expect(account.chatNavigation("CZX")).rejects.toThrow(/country/);
      await account.chatNavigation();
      await account.read("chat_navigation", { country: "sk" }) as unknown;
      expect(calls.map((c) => c.url)).toEqual([
        "https://chatbotapi.alza.cz/api/visitors/visitor-test/v1/navigation?country=CZ",
        "https://chatbotapi.alza.cz/api/visitors/visitor-test/v1/navigation?country=SK",
      ]);
    } finally { restore(); }
  });

  it("chat_send: validates inputs and sends the captured W18 body shape", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch(() => json());
    try {
      await expect(account.chatSend({})).rejects.toThrow(/page_type/);
      await expect(account.chatSend({ page_type: 99 })).rejects.toThrow(/page_type/);
      await expect(account.chatSend({ page_type: 1, referrer: "x".repeat(501) })).rejects.toThrow(/referrer/);
      await expect(account.chatSend({ page_type: 1, initial_input: "y".repeat(2001) })).rejects.toThrow(/initial_input/);
      await account.chatSend({ page_type: 6, referrer: "https://www.alza.cz/", initial_input: "Dobrý den", force_initialize: true });
      expect(calls[0].url).toBe("https://chatbotapi.alza.cz/api/visitors/visitor-test/v1/chat?country=CZ");
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({
        country: "CZ", pageType: 6, forceInitialize: true, initialInput: "Dobrý den",
        referrer: "https://www.alza.cz/", listCategoryId: [],
        commodityType: 0, commodityCode: null, manufacturer: null, entityId: null, seoPrefix: null,
      });
      // product context mapping (the captured sample shape)
      await account.chatSend({ page_type: 1, list_category_id: [{ category_id: 18857192, category_type_id: 1 }], commodity_code: "HRAif8316", seo_prefix: "Pexeso" });
      expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ listCategoryId: [{ categoryId: 18857192, categoryTypeId: 1 }], commodityCode: "HRAif8316", seoPrefix: "Pexeso" });
    } finally { restore(); }
  });

  it("web_zip_codes: the WCF twin takes {Search: input} and unwraps the d envelope", async () => {
    const account = makeAccount();
    const { calls, restore } = mockFetch((url) => url.includes("GetZipCodes")
      ? wcf({ Value: '<div class="zip-item" data-id="3022826" data-city="Hradec Králové" data-text="500 00">', ErrorLevel: 0 })
      : json());
    try {
      await expect(account.read("web_zip_codes", { input: "" })).rejects.toThrow(/input/);
      const out = await account.read("web_zip_codes", { input: "Hradec Králové" }) as { Value: string; ErrorLevel: number };
      expect(out.Value).toContain("zip-item");
      expect(calls[0].url).toBe("https://test.alza.invalid/Services/EShopService.svc/GetZipCodes");
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({ Search: "Hradec Králové" });
    } finally { restore(); }
  });
});

describe("mobile API bot-challenge browser fallback", () => {
  // Shape of the www/webapi bot wall's answer to plain HTTP clients (captured 2026-09-10).
  const CHALLENGE = '<!DOCTYPE html><html><head><title>Alza.cz</title></head><body><script>var getData = function () { var host = window.location.hostname.split(""); };</script></body></html>';
  const challenge = () => new Response(CHALLENGE, { status: 403, headers: { "content-type": "text/html" } });

  it("retries a same-origin bot-challenge 403 through the browser transport (navigate, refetch, succeed)", async () => {
    const trace: string[] = [];
    let pages = 0;
    const fakePage = {
      url: () => "about:blank",
      evaluate: async () => {
        pages += 1;
        trace.push(`evaluate#${pages}`);
        return pages === 1 ? { status: 403, text: CHALLENGE } : { status: 200, text: JSON.stringify({ err: 0, basket: { items: [] } }) };
      },
      goto: async (url: string) => { trace.push(`goto:${url}`); },
      waitForTimeout: async () => { trace.push("wait"); },
    };
    const browser = { withPage: async (fn: (p: never) => Promise<unknown>) => fn(fakePage as never) };
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => challenge()) as typeof fetch;
    try {
      const api = new MobileApi({ visitorId: "visitor-test", baseUrl: "https://www.alza.cz", browser: browser as never });
      const value = await api.request<{ err: number; basket: { items: string[] } }>("/services/restservice.svc/v3/basketInfo");
      expect(value).toEqual({ err: 0, basket: { items: [] } });
      // cold page → navigate to the base origin, fetch (still challenged), clear once more, refetch
      expect(trace).toEqual(["goto:https://www.alza.cz", "wait", "evaluate#1", "goto:https://www.alza.cz", "wait", "evaluate#2"]);
    } finally { globalThis.fetch = previous; }
  });

  it("surfaces the 403 error when the browser retry is still challenged", async () => {
    const fakePage = {
      url: () => "about:blank",
      evaluate: async () => ({ status: 403, text: CHALLENGE }),
      goto: async () => {},
      waitForTimeout: async () => {},
    };
    const browser = { withPage: async (fn: (p: never) => Promise<unknown>) => fn(fakePage as never) };
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => challenge()) as typeof fetch;
    try {
      const api = new MobileApi({ visitorId: "visitor-test", baseUrl: "https://www.alza.cz", browser: browser as never });
      await expect(api.request("/services/restservice.svc/v3/basketInfo")).rejects.toThrow(/HTTP 403/);
    } finally { globalThis.fetch = previous; }
  });

  it("leaves cross-host routes and non-challenge 403s to the plain transport", async () => {
    const closedBrowser = () => {
      let opened = 0;
      return {
        browser: { withPage: async () => { opened += 1; throw new Error("must not open a page"); } } as never,
        count: () => opened,
      };
    };
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => challenge()) as typeof fetch;
    try {
      // cross-host absolute URL: the same-origin guard keeps the browser closed
      const first = closedBrowser();
      const api = new MobileApi({ visitorId: "visitor-test", baseUrl: "https://www.alza.cz", browser: first.browser });
      await expect(api.request("https://chatbotapi.alza.cz/api/visitors/v/v1/navigation?country=CZ")).rejects.toThrow(/HTTP 403/);
      expect(first.count()).toBe(0);

      // JSON-shaped 403 (a real API denial, not the bot wall): no browser engagement
      globalThis.fetch = (async () => new Response(JSON.stringify({ err: 1, message: "forbidden" }), { status: 403, headers: { "content-type": "application/json" } })) as typeof fetch;
      const second = closedBrowser();
      const api2 = new MobileApi({ visitorId: "visitor-test", baseUrl: "https://www.alza.cz", browser: second.browser });
      await expect(api2.request("/services/restservice.svc/v3/basketInfo")).rejects.toThrow(/HTTP 403/);
      expect(second.count()).toBe(0);
    } finally { globalThis.fetch = previous; }
  });

  it("preserves the plain-transport 403 when no browser is wired", async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => challenge()) as typeof fetch;
    try {
      const api = new MobileApi({ visitorId: "visitor-test", baseUrl: "https://www.alza.cz" });
      await expect(api.request("/services/restservice.svc/v3/basketInfo")).rejects.toThrow(/HTTP 403/);
    } finally { globalThis.fetch = previous; }
  });
});
