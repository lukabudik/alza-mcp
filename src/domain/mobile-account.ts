import { randomBytes } from "node:crypto";
import type { MobileApi, OAuthStart } from "../infra/mobile-api.js";
import type { AppActionFilePart, AppActionValue, ServerAppAction } from "../infra/app-action.js";

/** Every guarded mutation accepted by `prepare_mutation` (and the typed tools). */
export const MUTATION_ACTIONS = [
  // low-risk whitelisted writes (executed via mutate_list)
  "create", "rename", "delete", "add", "remove", "move", "set_country", "set_isic",
  "add_gift", "add_order_service", "set_watchdog", "send_feedback", "submit_discussion", "rate_discussion",
  "coupon_add", "coupon_remove", "basket_update", "basket_unlock",
  // high-impact writes (executed via the typed tools)
  "after_order_payment", "register", "address_create", "address_edit", "address_delete",
  "review_submit", "subscription_activate", "subscription_update_installment", "attachment_upload",
  // web checkout family (legacy WCF pipeline O11 + web pickup W11–W14, 2026-09-08)
  "web_place_order", "web_after_order_payment", "cancel_order",
  // GDPR data export (A17, 2026-09-22): POSTs the sendGdprInfoForm target —
  // Alza queues the XML export to the account's own login email (202 Accepted).
  "gdpr_export",
  // account credential/identity mutations (A14–A18, 2026-09-22): static routes
  // probed live; one-time token each; delete_account is irreversible.
  "change_password", "two_factor_set", "phone_change", "email_change", "delete_account",
] as const;

const WHITELISTED_MUTATIONS = new Set<string>([
  "create", "rename", "delete", "add", "remove", "move", "set_country", "set_isic",
  "add_gift", "add_order_service", "set_watchdog", "send_feedback", "submit_discussion", "rate_discussion",
  "coupon_add", "coupon_remove", "basket_update", "basket_unlock",
  "gdpr_export",
]);

const ADDRESS_TYPES = new Set(["HOME", "WORK", "OTHER"]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ZIP_RE = /^[\dA-Za-z -]{3,12}$/;

function requireString(payload: Record<string, unknown>, field: string, max = 200): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`${field} must be a non-empty string (max ${max})`);
  return value;
}
/** Numeric Alza user id (1-16 digits) — the path segment of the userAccount/
 * orders/warrantyClaims user routes. Taken from a prior MCP response (e.g. the
 * `user_id` field of the `user_data` read) — never free-form. */
function requireUserId(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!/^\d{1,16}$/.test(s)) throw new Error("user_id must be the numeric Alza user id (take it from the user_data read, e.g. 100000001)");
  return s;
}
function optionalString(payload: Record<string, unknown>, field: string, max = 200): string | undefined {
  if (!(field in payload) || payload[field] === null || payload[field] === undefined || payload[field] === "") return undefined;
  return requireString(payload, field, max);
}
function requireInt(payload: Record<string, unknown>, field: string): number {
  const value = payload[field];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  return value;
}
function optionalInt(payload: Record<string, unknown>, field: string): number | undefined {
  if (!(field in payload) || payload[field] === null || payload[field] === undefined) return undefined;
  return requireInt(payload, field);
}
function validateTypedValues(values: Array<{ name?: unknown; value?: unknown; kind?: unknown }>, limit = 20): AppActionValue[] {
  if (values.length > limit) throw new Error(`values must contain at most ${limit} entries`);
  return values.map((v) => {
    if (!v || typeof v.name !== "string" || !v.name || v.name.length > 64) throw new Error("value names must be non-empty strings (max 64)");
    const kind = v.kind === undefined ? undefined : String(v.kind);
    if (kind !== undefined && !["text", "integer", "boolean", "decimal", "text-array", "integer-array"].includes(kind)) throw new Error(`unsupported value kind: ${kind}`);
    return { name: v.name, value: v.value, kind: kind as AppActionValue["kind"] };
  });
}
function validateAddressPayload(payload: Record<string, unknown>): void {
  requireString(payload, "name", 100);
  requireString(payload, "street", 100);
  requireString(payload, "city", 100);
  const zip = requireString(payload, "zip_code", 10);
  if (!ZIP_RE.test(zip)) throw new Error("zip_code must be 3-12 alphanumeric characters, spaces, or dashes");
  const addressType = optionalString(payload, "address_type", 8);
  if (addressType && !ADDRESS_TYPES.has(addressType)) throw new Error(`address_type must be one of HOME, WORK, OTHER (got ${addressType})`);
  const email = optionalString(payload, "email", 100);
  if (email && !EMAIL_RE.test(email)) throw new Error("email is not a valid email address");
  const phone = optionalString(payload, "phone", 20);
  if (phone && !/^[\d+()\s-]{6,20}$/.test(phone)) throw new Error("phone must be 6-20 characters (digits, +, parens, spaces, dashes)");
}
function validateRegisterPayload(payload: Record<string, unknown>): void {
  const email = requireString(payload, "email", 100);
  if (!EMAIL_RE.test(email)) throw new Error("email is not a valid email address");
  const phone = requireString(payload, "phone", 20);
  if (!/^[\d+()\s-]{6,20}$/.test(phone)) throw new Error("phone must be 6-20 characters (digits, +, parens, spaces, dashes)");
  const pwd = requireString(payload, "pwd", 64);
  if (pwd.length < 8) throw new Error("pwd must be at least 8 characters");
  optionalString(payload, "code", 32);
}
function validateAfterOrderPaymentPayload(payload: Record<string, unknown>): void {
  requireString(payload, "order_id", 64);
  requireString(payload, "invoice_number", 64);
  const paymentId = requireInt(payload, "payment_id");
  if (paymentId < 1) throw new Error("payment_id must be a positive integer");
  const cardId = optionalInt(payload, "card_id");
  if (cardId !== undefined && cardId < 1) throw new Error("card_id must be a positive integer");
  optionalString(payload, "device_fingerprint", 128);
}
function optionalFloat(payload: Record<string, unknown>, field: string, min: number, max: number): number | undefined {
  if (!(field in payload) || payload[field] === null || payload[field] === undefined) return undefined;
  const value = payload[field];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  if (value < min || value > max) throw new Error(`${field} must be between ${min} and ${max}`);
  return value;
}
function optionalPositiveNumber(payload: Record<string, unknown>, field: string): number | undefined {
  if (!(field in payload) || payload[field] === null || payload[field] === undefined) return undefined;
  const value = payload[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number`);
  return value;
}
function validateConsents(payload: Record<string, unknown>, field: string): Array<{ consentId: string; value: boolean }> {
  if (!(field in payload) || payload[field] === undefined || payload[field] === null) return [];
  const list = payload[field];
  if (!Array.isArray(list) || list.length > 10) throw new Error(`${field} must be an array of at most 10 {consent_id, value} entries`);
  return list.map((c, i) => {
    if (!c || typeof c !== "object") throw new Error(`${field}[${i}] must be an object`);
    const consentId = (c as Record<string, unknown>).consent_id;
    const value = (c as Record<string, unknown>).value;
    if (typeof consentId !== "string" || consentId.length === 0 || consentId.length > 64) throw new Error(`${field}[${i}].consent_id must be a string (max 64)`);
    if (typeof value !== "boolean") throw new Error(`${field}[${i}].value must be a boolean`);
    return { consentId, value };
  });
}
function validateFileParts(files: Array<Record<string, unknown>>): AppActionFilePart[] {
  if (files.length === 0 || files.length > 5) throw new Error("files must be an array of 1-5 file parts");
  return files.map((f) => {
    const partName = requireString(f, "part_name", 64);
    const fileName = requireString(f, "file_name", 200);
    const mimeType = optionalString(f, "mime_type", 64) ?? "";
    const dataUrl = requireString(f, "data_url", 14 * 1024 * 1024);
    if (!/^data:/.test(dataUrl)) throw new Error("data_url must be a base64 data URL");
    return { partName, fileName, mimeType, dataUrl };
  });
}

export interface MobileCheckoutPreview {
  cart: unknown;
  deliveryPaymentGroups: unknown;
  checkoutState: unknown;
  confirmationToken: string;
}

function validateListPayload(action: string, payload: Record<string, unknown>): void {
  const required: Record<string, string[]> = {
    create: ["name"], rename: ["id", "name"], delete: ["id"],
    add: ["productId", "commodityListType"], remove: ["id", "productId"], move: ["id", "productId", "targetId"],
    set_country: ["countryId"], set_isic: ["isic"],
    add_gift: ["rangeIdsGiftCodes"], set_watchdog: ["commodityId", "email", "isTrackingStock"], send_feedback: ["text", "info"], add_order_service: ["orderItemId", "enabled", "selected"], // orderItemId: live correction 2026-09-10 (server ModelState binds Int32)
    submit_discussion: ["commodityId", "msg", "userEmail", "anonymous", "notifications"], rate_discussion: ["postId", "rating"],
    coupon_add: ["coupon"], coupon_remove: ["couponId"], basket_update: ["basket_id"], basket_unlock: [], gdpr_export: ["user_id"], // couponId: live correction 2026-09-10 (delcoupon binds Int32)
  };
  for (const field of required[action] ?? []) {
    if (!(field in payload) || payload[field] === null || payload[field] === "") throw new Error(`Missing required ${action} payload field: ${field}`);
  }
  for (const field of ["id", "productId", "commodityListType", "targetId", "orderItemId", "couponId"]) {
    if (field in payload && (typeof payload[field] !== "number" || !Number.isInteger(payload[field]))) throw new Error(`${field} must be an integer`);
  }
  if (("name" in payload) && typeof payload.name !== "string") throw new Error("name must be a string");
  if (action === "set_watchdog" && typeof payload.email !== "string") throw new Error("email must be a string");
  if (action === "send_feedback" && (typeof payload.text !== "string" || typeof payload.info !== "string")) throw new Error("feedback text and info must be strings");
}

export class MobileAccount {
  private pending?: MobileCheckoutPreview;
  private pendingMutation?: { token: string; action: string };
  constructor(private readonly api: MobileApi) {}

  async authStart(): Promise<OAuthStart> { return this.api.startOAuth(); }
  async authDiscovery(): Promise<unknown> { return this.api.discovery(); }
  async authExchange(code: string, state: string): Promise<unknown> { return this.api.exchangeOAuthCode(code, state); }

  async read(operation: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (operation) {
      case "url_info": return this.api.urlInfo(String(args.url ?? ""));
      case "legacy_product": return this.api.legacyProduct(Number(args.product_id), { pgrik: args.pgrik ? String(args.pgrik) : undefined, ucik: args.ucik ? String(args.ucik) : undefined, country: args.country ? String(args.country) : undefined, electronicContentOnly: args.electronic_content_only === undefined ? undefined : Boolean(args.electronic_content_only) });
      case "router_product": return this.api.routerProduct(Number(args.product_id), { pgrik: args.pgrik ? String(args.pgrik) : undefined, ucik: args.ucik ? String(args.ucik) : undefined, country: args.country ? String(args.country) : undefined, electronicContentOnly: args.electronic_content_only === undefined ? undefined : Boolean(args.electronic_content_only) });
      case "quick_order_summary": return this.api.quickOrderSummary(String(args.user_id ?? ""), Number(args.commodity_id), { pgrik: args.pgrik ? String(args.pgrik) : undefined, ucik: args.ucik ? String(args.ucik) : undefined });
      case "user_review": return this.api.commodityReviews(Number(args.commodity_id));
      case "discussion_posts": return this.api.discussionPosts(Number(args.commodity_id), Number(args.page_start ?? 0), { parentId: args.parent_id === undefined ? undefined : Number(args.parent_id), showOnlyWithoutAnswer: args.show_only_without_answer === undefined ? undefined : Boolean(args.show_only_without_answer), orderBy: args.order_by === undefined ? undefined : Number(args.order_by) });
      case "premium_trial": return this.api.premiumTrial(String(args.user_id ?? ""));
      case "validate_login_name": return this.api.validateLoginName(String(args.email ?? ""));
      case "o3_info": return this.api.o3Info();
      case "validate_isic": return this.api.validateIsic({ cardNumber: String(args.card_number ?? ""), name: String(args.name ?? "") });
      case "order_helpdesk_questions": return this.api.orderHelpdeskQuestions();
      case "user_data": return this.api.userData();
      case "contacts": return this.api.contacts();
      case "visitor_navigation": return this.api.visitorNavigation();
      case "user_navigation": return this.api.userNavigation(String(args.user_id ?? ""), args.eshop_url ? String(args.eshop_url) : undefined);
      case "catalog_user_navigation": return this.api.catalogUserNavigation();
      case "anonymous_orders": return this.api.anonymousOrders(String(args.invoice_number ?? ""));
      case "anonymous_order": return this.api.anonymousOrder(String(args.order_id ?? ""));
      case "user_order": return this.api.userOrder(Number(args.user_flag ?? 0), String(args.order_id ?? ""), Boolean(args.initial_created));
      case "order_part": return this.api.orderPart(String(args.order_id ?? ""), String(args.part_id ?? ""));
      case "after_order_payments": return this.api.afterOrderPayments(String(args.order_id ?? ""), String(args.part_id ?? ""));
      case "order_add_info": return this.api.orderAddInfo();
      case "order2_info": return this.api.order2Info();
      case "delivery_countries": return this.api.deliveryCountries();
      case "commodity_lists": return this.api.commodityLists(args.type === undefined ? undefined : Number(args.type));
      case "commodity_list": return this.api.commodityList(Number(args.list_id));
      case "alternatives": return this.api.alternatives(Number(args.commodity_id));
      case "branches": return this.api.branches(Number(args.latitude), Number(args.longitude));
      case "zip_codes": return this.api.zipCodes(args.query ? String(args.query) : undefined);
      case "search": return this.api.search(String(args.search_term ?? ""), Number(args.page ?? 0));
      case "category": return this.api.category(Number(args.category_id), args.type ? String(args.type) : "CATEGORY", Number(args.type_id ?? 0));
      case "facets": return this.api.facets(Number(args.category_id), args.type ? String(args.type) : "CATEGORY", Number(args.type_id ?? 0), args.search ? String(args.search) : "");
      case "ean_lookup": {
        const list = Array.isArray(args.ean_list) ? args.ean_list.map(String) : [];
        if (list.length === 0 || list.length > 20) throw new Error("ean_list must be an array of 1-20 EAN strings");
        return this.api.eanLookup(list);
      }
      case "hierarchical_filter": return this.api.hierarchicalFilter(args as Record<string, unknown>);
      case "basket_info": return this.api.cartInfo();
      case "cart": return this.api.cart();
      case "cost_estimate": return this.api.costEstimate(args as Record<string, unknown>);
      case "web_after_payment_dialog": return this.webAfterPaymentDialog(String(args.order_id ?? ""), args.order_hash === undefined ? undefined : String(args.order_hash));
      case "web_zip_codes": {
        const input = String(args.input ?? "");
        if (input.length === 0 || input.length > 64) throw new Error("input must be a place name or zip (1-64 chars)");
        return this.api.webZipCodes(input);
      }
      case "chat_navigation": {
        const country = args.country === undefined ? undefined : String(args.country);
        return this.chatNavigation(country);
      }
      case "home_categories": {
        const categoryId = Number(args.category_id ?? 1);
        if (!Number.isInteger(categoryId) || categoryId < 1) throw new Error("category_id must be a positive integer");
        const pgri = args.pgri === undefined ? undefined : String(args.pgri);
        const ui = args.ui === undefined ? undefined : String(args.ui);
        for (const [name, value] of [["pgri", pgri], ["ui", ui]] as const) {
          if (value !== undefined && (value.length === 0 || value.length > 64)) throw new Error(`${name} must be a string (max 64; copy it from the catalog_user_navigation response)`);
        }
        return this.api.homeCategories(categoryId, pgri, ui);
      }
      default: throw new Error(`Unsupported mobile read operation: ${operation}`);
    }
  }

  status(): { authenticated: boolean; visitorId: string; apiBaseUrl: string } {
    return { authenticated: this.api.isAuthenticated, visitorId: this.api.visitorId, apiBaseUrl: this.api.baseUrl };
  }

  /** Typed user-management reads (profile/address book, contacts). */
  async profile(): Promise<unknown> { return this.api.userData(); }
  async contacts(): Promise<unknown> { return this.api.contacts(); }

  /** Registration (APK `Register` DTO) — high-impact, one-time token. */
  async register(payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("register", token);
    validateRegisterPayload(payload);
    const result = await this.api.register({ email: payload.email as string, phone: payload.phone as string, pwd: payload.pwd as string, code: optionalString(payload, "code", 32) });
    this.pendingMutation = undefined;
    return result;
  }

  private assertMutationToken(action: string, token: string): void {
    if (!this.pendingMutation || this.pendingMutation.action !== action || this.pendingMutation.token !== token) {
      throw new Error(`Invalid or expired ${action} confirmation token; call prepare_mutation again.`);
    }
  }

  private actionFrom(action: Record<string, unknown>): ServerAppAction {
    const a = action as unknown as ServerAppAction;
    if (!a || typeof a !== "object" || !a.form || typeof a.form !== "object" || !a.form.meta || typeof a.form.meta.href !== "string" || !a.form.meta.href) {
      throw new Error("action must be an AppAction object with form.meta.href (copy it from the response of a prior alza tool)");
    }
    return a;
  }

  private executeAction(action: ServerAppAction, opts: { token?: string; extraValues?: AppActionValue[]; files?: AppActionFilePart[] } = {}): Promise<unknown> {
    return this.api.executeAppAction(action, {
      allowMutation: true,
      confirmationToken: opts.token,
      extraValues: opts.extraValues,
      files: opts.files,
    });
  }

  /** Address-book create/edit (dynamic form action from the profile response). */
  async addressUpsert(kind: "create" | "edit", action: Record<string, unknown>, payload: Record<string, unknown>, token: string): Promise<unknown> {
    const op = kind === "create" ? "address_create" : "address_edit";
    this.assertMutationToken(op, token);
    validateAddressPayload(payload);
    const extra: AppActionValue[] = [
      { name: "name", value: payload.name, kind: "text" },
      { name: "street", value: payload.street, kind: "text" },
      { name: "city", value: payload.city, kind: "text" },
      { name: "zipCode", value: payload.zip_code, kind: "text" },
    ];
    for (const field of ["firm", "phone", "email", "note"]) {
      const value = optionalString(payload, field, 100);
      if (value !== undefined) extra.push({ name: field, value, kind: "text" });
    }
    const addressType = optionalString(payload, "address_type", 8);
    if (addressType) extra.push({ name: "addressType", value: addressType, kind: "text" });
    const addressId = optionalInt(payload, "address_id");
    if (kind === "edit" && addressId !== undefined) extra.push({ name: "id", value: addressId, kind: "integer" });
    const result = await this.executeAction(this.actionFrom(action), { token, extraValues: extra });
    this.pendingMutation = undefined;
    return result;
  }

  /** Address-book delete (per-address delete action from the profile response). */
  async addressDelete(action: Record<string, unknown>, payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("address_delete", token);
    const addressId = requireInt(payload, "address_id");
    const result = await this.executeAction(this.actionFrom(action), { token, extraValues: [{ name: "id", value: addressId, kind: "integer" }] });
    this.pendingMutation = undefined;
    return result;
  }

  /** Address search/autocomplete (read, no token). */
  async addressSearch(action: Record<string, unknown>, query: string): Promise<unknown> {
    if (typeof query !== "string" || query.length === 0 || query.length > 50) throw new Error("query must be a non-empty string (max 50)");
    return this.api.executeAppAction(this.actionFrom(action), { extraValues: [{ name: "search", value: query, kind: "text" }] });
  }

  /** OR6 (2026-09-22): order search — typed read over the server-provided
   * search form (`POST .../v1/orders/search/results`, form-urlencoded). */
  async orderSearch(searchTerm: string, userId?: string): Promise<unknown> {
    const term = String(searchTerm ?? "").trim();
    if (term.length === 0 || term.length > 64) throw new Error("search_term must be 1-64 characters (e.g. an order number like '1058 423 434')");
    const uid = requireUserId(userId ?? this.api.userId);
    return this.api.orderSearch(uid, term);
  }

  /** OR7 (2026-09-24): order archive read — typed read over the orders
   * navigation's `archiveOrders` section (`GET .../v1/orders/archive`).
   * Read-only (no token). `hide_cancelled_orders` mirrors the app's
   * "Skrýt zrušené" toggle; the APK form default is `false` (include cancelled). */
  async orderArchive(opts: { user_id?: string; hide_cancelled_orders?: boolean; limit?: number } = {}): Promise<unknown> {
    const uid = requireUserId(opts.user_id ?? this.api.userId);
    const hide = opts.hide_cancelled_orders ?? false;
    if (typeof hide !== "boolean") throw new Error("hide_cancelled_orders must be a boolean");
    let limit: number | undefined;
    if (opts.limit !== undefined) {
      limit = opts.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be an integer between 1 and 100");
    }
    return this.api.orderArchive(uid, hide, limit);
  }

  /** AT3 (2026-09-24): vision/barcode product lookup — typed read over the APK's
   * static route `POST .../v1/getProductByEANlist` (`{eanList}`). Read-only. */
  async productByEan(eans: unknown): Promise<unknown> {
    if (!Array.isArray(eans) || eans.length === 0 || eans.length > 20) {
      throw new Error("eans must be a non-empty array of at most 20 barcode values");
    }
    const list = eans.map((v, i) => {
      const s = String(v ?? "").trim();
      if (!/^\d{6,14}$/.test(s)) throw new Error(`eans[${i}] must be a 6-14 digit barcode (EAN-8/13/14)`);
      return s;
    });
    return this.api.productByEan(list);
  }

  /** A17 (2026-09-22): GDPR section read — the "Osobní údaje" details
   * (`gdprInfoAction` + `deleteAccountAction`) plus the export dialog
   * (`AccountGdprDialog` with `emailInfo` + `sendGdprInfoForm`). Read-only. */
  async gdprInfo(userId: string): Promise<unknown> {
    const uid = requireUserId(userId);
    const personalDetails = await this.api.userAccountPersonalDetails(uid);
    const pd = (personalDetails ?? {}) as Record<string, unknown>;
    const action = (pd.gdprInfoAction ?? {}) as Record<string, unknown>;
    let gdprDialog: unknown = null;
    try {
      gdprDialog = await this.api.gdprDialog(uid);
    } catch (err) {
      // The dialog read is a follow-up; keep the primary section visible even
      // if the dialog route is temporarily down (the action href is in personalDetails).
      gdprDialog = { error: err instanceof Error ? err.message : String(err), gdprInfoAction: action };
    }
    return { personalDetails, gdprDialog };
  }

  /** A17 (2026-09-22): GDPR export trigger (low-risk mutation, one-time token).
   * Sends the XML personal-data export to the account's own login email. */
  async gdprExport(payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("gdpr_export", token);
    const uid = requireUserId(payload.user_id);
    const result = await this.api.gdprExport(uid);
    this.pendingMutation = undefined;
    return result ?? { accepted: true };
  }

  /** A14 (2026-09-22): change the account password (credential mutation, one-time
   * token). Logs the user out of every device on success. */
  async changePassword(payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("change_password", token);
    const uid = requireUserId(payload.user_id);
    const oldPassword = requireString(payload, "old_password", 64);
    const newPassword = requireString(payload, "new_password", 64);
    const confirm = requireString(payload, "new_password_confirm", 64);
    if (newPassword.length < 8) throw new Error("new_password must be at least 8 characters");
    if (newPassword !== confirm) throw new Error("new_password and new_password_confirm must match");
    if (newPassword === oldPassword) throw new Error("new_password must differ from old_password");
    const result = await this.api.changePassword(uid, oldPassword, newPassword);
    this.pendingMutation = undefined;
    return result ?? { changed: true };
  }

  /** A15 (2026-09-22): enable/disable SMS two-factor (one-time token). */
  async twoFactorSet(payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("two_factor_set", token);
    const uid = requireUserId(payload.user_id);
    const enabled = payload.enabled;
    if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean (true to turn 2FA on, false to turn it off)");
    const result = await this.api.setTwoFactor(uid, enabled);
    this.pendingMutation = undefined;
    return result ?? { enabled };
  }

  /** A16 (2026-09-22): change the contact phone number (one-time token).
   * Accepts separators (`+420 777 123 456`); sends the compact international
   * form (the account's stored shape, e.g. `+420601234567`). */
  async phoneChange(payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("phone_change", token);
    const uid = requireUserId(payload.user_id);
    const phone = requireString(payload, "phone", 24).replace(/[\s-]/g, "");
    if (!/^\+\d{1,3}\d{5,15}$/.test(phone)) throw new Error("phone must be an international number, e.g. '+420777123456' (separators allowed)");
    const result = await this.api.changePhone(uid, phone);
    this.pendingMutation = undefined;
    return result ?? { phone };
  }

  /** A16 bonus (2026-09-22): change the contact email (one-time token). */
  async emailChange(payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("email_change", token);
    const uid = requireUserId(payload.user_id);
    const email = requireString(payload, "email", 100);
    if (!EMAIL_RE.test(email)) throw new Error("email must be a valid address");
    const result = await this.api.changeEmail(uid, email);
    this.pendingMutation = undefined;
    return result ?? { email };
  }

  /** A18 (2026-09-22): delete the account (irreversible, one-time token). */
  async deleteAccount(payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("delete_account", token);
    const uid = requireUserId(payload.user_id);
    const result = await this.api.deleteAccount(uid);
    this.pendingMutation = undefined;
    return result ?? { deleted: true };
  }

  /** K2 (2026-09-22): claim/complaint detail — executes the per-claim
   * `detailAction` copied verbatim from the `complaint_claims` list response
   * (same executor pattern as K1; read-only, no token). */
  async claimDetail(action: Record<string, unknown>): Promise<unknown> {
    return this.api.executeAppAction(this.actionFrom(action));
  }

  /** OR10 (2026-09-22): invoice/document download. `document` is the
   * `Document`/`Attachment` object (`{name?, self: {href}}`) copied verbatim
   * from a prior MCP response (order detail, order search results). The href
   * is origin-validated to the Alza host family (live invoices: pdf.alza.cz). */
  async orderDocument(document: Record<string, unknown>): Promise<unknown> {
    const self = (document?.self ?? {}) as Record<string, unknown>;
    const href = self.href;
    if (typeof href !== "string" || href.length === 0) {
      throw new Error("document.self.href is required (copy the Document object verbatim from a prior order/search response)");
    }
    const out = await this.api.downloadDocument(href);
    const name = typeof document.name === "string" ? document.name : null;
    return { name, ...out };
  }

  /** Payments family. */
  async paymentMethods(selectedDeliveryOptionId?: number): Promise<unknown> {
    if (selectedDeliveryOptionId !== undefined && (!Number.isInteger(selectedDeliveryOptionId) || selectedDeliveryOptionId < 1)) throw new Error("selected_delivery_option_id must be a positive integer");
    return this.api.paymentMethods(selectedDeliveryOptionId);
  }

  async afterOrderPayments(orderId: string, partId: string): Promise<unknown> {
    if (typeof orderId !== "string" || orderId.length === 0 || orderId.length > 64) throw new Error("order_id must be a non-empty string (max 64)");
    if (typeof partId !== "string" || partId.length === 0 || partId.length > 64) throw new Error("part_id must be a non-empty string (max 64)");
    return this.api.afterOrderPayments(orderId, partId);
  }

  /** After-order payment execution (APK `AfterOrderRequestBody`) — money movement, one-time token. */
  async payAfterOrder(payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("after_order_payment", token);
    validateAfterOrderPaymentPayload(payload);
    const result = await this.api.afterOrderPayment({
      id: payload.order_id as string,
      invoiceNumber: payload.invoice_number as string,
      paymentId: payload.payment_id as number,
      cardId: optionalInt(payload, "card_id"),
      deviceFingerprint: optionalString(payload, "device_fingerprint", 128),
    });
    this.pendingMutation = undefined;
    return result;
  }

  /** Web HATEOAS cart family (m.alza.cz checkout; W3–W5, gap-analysis G4).
   * The add is visitor-keyed (Balancer-Guid) and returns the basket id in its
   * HATEOAS links (`order/{basketId}/item/{itemId}`), which `webCart` needs. */
  async webAddToCart(payload: Record<string, unknown>): Promise<unknown> {
    const commodityId = requireInt(payload, "commodity_id");
    if (commodityId < 1) throw new Error("commodity_id must be a positive integer");
    const count = payload.count === undefined || payload.count === null ? 1 : requireInt(payload, "count");
    if (count < 1 || count > 99) throw new Error("count must be between 1 and 99");
    const res = await this.api.webAddToCart(commodityId, count);
    const m = JSON.stringify(res).match(/order\/(\d+)\/item\/(\d+)/);
    return { basket_id: m ? Number(m[1]) : undefined, item_id: m ? Number(m[2]) : undefined, response: res };
  }

  async webCart(basketId: number): Promise<unknown> {
    if (!Number.isInteger(basketId) || basketId < 1) throw new Error("basket_id must be a positive integer (from web_add_to_cart)");
    return this.api.webCart(basketId);
  }

  /** Chatbot family (W18, P2 implemented 2026-09-09). Session-scoped,
   * visitor-keyed (no account state) — the send is a conversational write,
   * token-free like web_add_to_cart. */
  async chatNavigation(country?: string): Promise<unknown> {
    const c = country === undefined ? "CZ" : String(country);
    if (!/^[A-Za-z]{2}$/.test(c)) throw new Error("country must be a 2-letter code (e.g. CZ)");
    return this.api.chatNavigation(c.toUpperCase());
  }

  async chatSend(payload: Record<string, unknown>): Promise<unknown> {
    const pageType = requireInt(payload, "page_type");
    if (pageType < 1 || pageType > 30) throw new Error("page_type must be 1-30 (1=product detail, 5=Order1, 6=Order2, 24=Order4 per the W18 capture)");
    const country = payload.country === undefined ? "CZ" : String(payload.country);
    if (!/^[A-Za-z]{2}$/.test(country)) throw new Error("country must be a 2-letter code (e.g. CZ)");
    const opt = (name: string, max: number): string | null => {
      if (payload[name] === undefined || payload[name] === null) return null;
      const v = String(payload[name]);
      if (v.length > max) throw new Error(`${name} must be at most ${max} characters`);
      return v;
    };
    const listCategoryId = payload.list_category_id === undefined || payload.list_category_id === null
      ? []
      : (payload.list_category_id as Record<string, unknown>[]).map((e) => ({ categoryId: requireInt(e as Record<string, unknown>, "category_id"), categoryTypeId: requireInt(e as Record<string, unknown>, "category_type_id") }));
    return this.api.chatSend({
      country: country.toUpperCase(), pageType, forceInitialize: payload.force_initialize === true,
      initialInput: opt("initial_input", 2000), referrer: opt("referrer", 500), listCategoryId,
      commodityType: payload.commodity_type === undefined ? 0 : requireInt(payload, "commodity_type"),
      commodityCode: opt("commodity_code", 64), manufacturer: opt("manufacturer", 64),
      entityId: opt("entity_id", 64), seoPrefix: opt("seo_prefix", 128),
    });
  }

  async webZipCodes(input: string): Promise<unknown> {
    const s = String(input ?? "");
    if (s.length === 0 || s.length > 64) throw new Error("input must be a place name or zip (1-64 chars; the WCF twin takes {Search: input})");
    return this.api.webZipCodes(s);
  }

  /** Web pickup family (m.alza.cz checkout; live-mapped 2026-09-08, rows W11–W14).
   * Read-only, no token. Combines the availability form, the paginated place
   * list, and an optional single-place detail (the W14 call the web UI fires
   * on place selection). */
  async webPickupPlaces(args: Record<string, unknown>): Promise<unknown> {
    const latitude = optionalFloat(args, "latitude", -90, 90);
    const longitude = optionalFloat(args, "longitude", -180, 180);
    const orderId = optionalInt(args, "order_id");
    const groupId = optionalInt(args, "group_id");
    const placeId = optionalInt(args, "place_id");
    if (placeId !== undefined && placeId < 1) throw new Error("place_id must be a positive integer");
    let types: number[] | undefined;
    if ("types" in args && args.types !== null && args.types !== undefined) {
      if (!Array.isArray(args.types) || args.types.length === 0 || args.types.length > 5) throw new Error("types must be an array of 1-5 pickup type ids");
      types = args.types.map((t) => {
        if (typeof t !== "number" || !Number.isInteger(t) || t < 1) throw new Error("types entries must be positive integers");
        return t;
      });
    }
    const limit = optionalInt(args, "limit");
    if (limit !== undefined && (limit < 1 || limit > 100)) throw new Error("limit must be between 1 and 100");
    const offset = optionalInt(args, "offset");
    if (offset !== undefined && offset < 0) throw new Error("offset must be zero or positive");
    const form = await this.api.webPickupPlaceForm({ orderId, groupId, latitude, longitude });
    const places = await this.api.webPickupPlaces({ types, latitude, longitude, orderId, groupId, limit, offset });
    const detail = placeId === undefined ? undefined : await this.api.webPickupPlaceDetail(placeId, orderId, groupId);
    return { form, places, detail };
  }

  /** Legacy web WCF checkout pipeline (O11) — the verified order-submission
   * path (SaveOrder2 → SaveOrder3 → SaveAndConfirmOrder2 with the documented
   * 113-gate retry → CheckOrder4 → SendOrder4). High-impact, one-time token.
   * The `save2` state skips the AlzaPlus/leasing gates (subscription/leasing id 0). */
  async webPlaceOrder(payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("web_place_order", token);
    const deliveryId = requireInt(payload, "delivery_id");
    if (deliveryId < 1) throw new Error("delivery_id must be a positive integer");
    const groupId = optionalInt(payload, "delivery_group_id");
    if (groupId !== undefined && groupId < 0) throw new Error("delivery_group_id must be zero or positive");
    const parcelShopId = optionalString(payload, "parcel_shop_id", 32);
    const paymentId = requireInt(payload, "payment_id");
    if (paymentId < 1) throw new Error("payment_id must be a positive integer");
    const name = requireString(payload, "name", 100);
    const street = requireString(payload, "street", 100);
    const city = requireString(payload, "city", 100);
    const zip = requireString(payload, "zip_code", 12);
    if (!ZIP_RE.test(zip)) throw new Error("zip_code must be 3-12 alphanumeric characters, spaces, or dashes");
    const phone = requireString(payload, "phone", 20);
    if (!/^[\d+()\s-]{6,20}$/.test(phone)) throw new Error("phone must be 6-20 characters (digits, +, parens, spaces, dashes)");
    const email = requireString(payload, "email", 100);
    if (!EMAIL_RE.test(email)) throw new Error("email is not a valid email address");
    const registerUser = payload.register_user === undefined ? false : Boolean(payload.register_user);
    const login = optionalString(payload, "login", 100) ?? email;
    const countryId = optionalInt(payload, "country_id") ?? 0;
    const quotation = payload.quotation === undefined ? false : Boolean(payload.quotation);
    const internalDescription = optionalString(payload, "internal_description", 2000) ?? "";
    const userConsents = validateConsents(payload, "user_consents");
    const basketConsents = validateConsents(payload, "basket_consents");

    const save2 = {
      selectedDeliveriesForGroups: [{
        deliveryGroupId: groupId ?? null,
        deliveryId,
        parcelShopId: parcelShopId ?? null,
        deliveryAccesoriesIds: [] as number[],
      }],
      paymentId,
      paymentCardId: 0,
      alzaPlusSubscriptionId: 0,
      cetelemLeasingId: 0,
    };
    const save3 = { registerUser, login, name, street, city, zip, phone, email, countryId };
    const send4 = { quotation, internalDescription, verificationId: null, verificationCode: null, userConsents, basketConsents };

    const checkStep = (op: string, res: Record<string, unknown>): void => {
      const level = Number(res.ErrorLevel ?? 0);
      if (level !== 0) throw new Error(`${op} failed with ErrorLevel ${level}${res.Message ? `: ${String(res.Message)}` : ""}`);
    };
    const save2Res = await this.api.webWcfStep("SaveOrder2", save2);
    checkStep("SaveOrder2", save2Res);
    const save3Res = await this.api.webWcfStep("SaveOrder3", save3);
    checkStep("SaveOrder3", save3Res);
    let confirmRes = await this.api.webWcfStep("SaveAndConfirmOrder2", save2);
    if (Number(confirmRes.ErrorLevel ?? 0) === 113) {
      // Documented AlzaPlus promo gate (O11): the web UI dismisses the popup
      // with “Nemám zájem”, equivalent to an immediate retry.
      await new Promise((r) => setTimeout(r, 1500));
      confirmRes = await this.api.webWcfStep("SaveAndConfirmOrder2", save2);
    }
    checkStep("SaveAndConfirmOrder2", confirmRes);
    const checkRes = await this.api.webWcfStep("CheckOrder4", {});
    checkStep("CheckOrder4", checkRes);
    const sendRes = await this.api.webWcfStep("SendOrder4", send4);
    checkStep("SendOrder4", sendRes);
    this.pendingMutation = undefined;
    const detail = (sendRes.GetOrderDetailAction ?? {}) as Record<string, unknown>;
    const webLink = typeof detail.webLink === "string" ? detail.webLink : typeof detail.href === "string" ? detail.href : undefined;
    // Live behavior (2026-09-06 and 2026-09-08): the top-level `OrderId` field of
    // the SendOrder4 response is 0; the created order id lives in
    // GetOrderDetailAction (webLink `order-details-{id}.htm` / href `/orders/{id}`).
    let orderId = typeof sendRes.OrderId === "number" && sendRes.OrderId > 0 ? sendRes.OrderId : undefined;
    if (orderId === undefined && webLink) {
      const m = webLink.match(/order-details-(\d+)\.htm|\/orders\/(\d+)/);
      if (m) orderId = Number(m[1] ?? m[2]);
    }
    return {
      error_levels: { SaveOrder2: save2Res.ErrorLevel, SaveOrder3: save3Res.ErrorLevel, SaveAndConfirmOrder2: confirmRes.ErrorLevel, CheckOrder4: checkRes.ErrorLevel, SendOrder4: sendRes.ErrorLevel },
      order_id: orderId,
      order_detail_link: webLink,
      send_order4: sendRes,
    };
  }

  /** Web after-payment dialog (PA8, read-only): the after-order payment
   * method list for an unpaid order. */
  async webAfterPaymentDialog(orderId: string, orderHash?: string): Promise<unknown> {
    if (typeof orderId !== "string" || orderId.length === 0 || orderId.length > 64) throw new Error("order_id must be a non-empty string (max 64)");
    if (orderHash !== undefined && (typeof orderHash !== "string" || orderHash.length > 64)) throw new Error("order_hash must be a string (max 64)");
    return this.api.webWcfStep("GetAfterPaymentDialog", { orderId, invoiceId: null, price: null, isPartialPay: false, isSwitchToCashAvailable: false, orderHash: orderHash ?? "" });
  }

  /** Web after-order payment execution (PA9, legacy WCF CreateAfterPayment) —
   * the verified real-payment path (2026-09-06: MojePlatba → KB SSO).
   * Money movement, high-impact, one-time token. */
  async webAfterOrderPayment(payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("web_after_order_payment", token);
    const orderId = requireString(payload, "order_id", 64);
    const paymentId = requireInt(payload, "payment_id");
    if (paymentId < 1) throw new Error("payment_id must be a positive integer");
    const hash = optionalString(payload, "order_hash", 64) ?? "";
    const invoiceId = optionalString(payload, "invoice_id", 32) ?? "0";
    const price = optionalPositiveNumber(payload, "price");
    const res = await this.api.webWcfStep("CreateAfterPayment", {
      orderId, paymentId, hash, enableAD: false,
      invoiceId, price: price ?? null,
      smsCode: null, smsId: 0, isTrusted: false,
      amountToPay: price ?? null, headerId: null, orderPaymentId: "0",
    });
    this.pendingMutation = undefined;
    return res;
  }

  /** Orders family: order read (+ optional part detail). */
  async order(orderId: string, partId?: string, userFlag = 0, initialCreated = false): Promise<unknown> {
    if (typeof orderId !== "string" || orderId.length === 0 || orderId.length > 64) throw new Error("order_id must be a non-empty string (max 64)");
    if (userFlag !== 0 && userFlag !== 1) throw new Error("user_flag must be 0 or 1");
    if (partId !== undefined && (typeof partId !== "string" || partId.length === 0 || partId.length > 64)) throw new Error("part_id must be a non-empty string (max 64)");
    const order = await this.api.userOrder(userFlag, orderId, initialCreated);
    if (partId === undefined) return { order };
    const part = await this.api.orderPart(orderId, partId);
    return { order, part };
  }

  /** OR11: cancel an order part. High-impact, one-time token like `web_place_order`.
   * `reason` mirrors the cancelForm's enum (0 = no reason given .. 5 = other);
   * defaults to 0. A 202 with an empty body is success (live-verified); the
   * order re-read may briefly show a "processing changes" transitional state
   * before settling to cancelled. */
  async cancelOrder(orderId: string, hash: string, partId: string, reason: number, token: string): Promise<unknown> {
    this.assertMutationToken("cancel_order", token);
    if (typeof orderId !== "string" || orderId.length === 0 || orderId.length > 64) throw new Error("order_id must be a non-empty string (max 64)");
    if (typeof hash !== "string" || hash.length === 0 || hash.length > 128) throw new Error("hash must be a non-empty string (max 128)");
    if (typeof partId !== "string" || partId.length === 0 || partId.length > 64) throw new Error("part_id must be a non-empty string (max 64)");
    if (!Number.isInteger(reason) || reason < 0 || reason > 5) throw new Error("reason must be an integer between 0 and 5");
    await this.api.orderCancelForm(orderId, hash, partId);
    await this.api.orderCancel(orderId, hash, partId, reason);
    this.pendingMutation = undefined;
    return { accepted: true, order_id: orderId, part_id: partId, reason };
  }

  /** Reviews / complaints / subscriptions / attachments (server-provided AppAction forms). */
  async reviewSubmit(action: Record<string, unknown>, payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("review_submit", token);
    const rating = requireInt(payload, "rating");
    if (rating < 1 || rating > 5) throw new Error("rating must be an integer between 1 and 5");
    const text = optionalString(payload, "text", 10000);
    const extra: AppActionValue[] = [{ name: "rating", value: rating, kind: "integer" }];
    if (text !== undefined) extra.push({ name: "text", value: text, kind: "text" });
    const values = payload.values;
    if (values !== undefined) {
      if (!Array.isArray(values)) throw new Error("values must be an array of {name, value, kind?}");
      extra.push(...validateTypedValues(values));
    }
    const result = await this.executeAction(this.actionFrom(action), { token, extraValues: extra });
    this.pendingMutation = undefined;
    return result;
  }

  async complaintClaims(action: Record<string, unknown>): Promise<unknown> {
    return this.api.executeAppAction(this.actionFrom(action));
  }

  async subscriptionOverview(action: Record<string, unknown>): Promise<unknown> {
    return this.api.executeAppAction(this.actionFrom(action));
  }

  async subscriptionActivate(action: Record<string, unknown>, payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("subscription_activate", token);
    const values = payload.values;
    if (values !== undefined && !Array.isArray(values)) throw new Error("values must be an array of {name, value, kind?}");
    const extra = values === undefined ? undefined : validateTypedValues(values);
    const result = await this.executeAction(this.actionFrom(action), { token, extraValues: extra });
    this.pendingMutation = undefined;
    return result;
  }

  async subscriptionUpdateInstallment(action: Record<string, unknown>, payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("subscription_update_installment", token);
    const values = payload.values;
    if (values !== undefined && !Array.isArray(values)) throw new Error("values must be an array of {name, value, kind?}");
    const extra = values === undefined ? undefined : validateTypedValues(values);
    const result = await this.executeAction(this.actionFrom(action), { token, extraValues: extra });
    this.pendingMutation = undefined;
    return result;
  }

  /** Attachment upload (multipart AppAction, one-time token). */
  async uploadAttachment(action: Record<string, unknown>, payload: Record<string, unknown>, token: string): Promise<unknown> {
    this.assertMutationToken("attachment_upload", token);
    if (!Array.isArray(payload.files)) throw new Error("files must be an array of file parts");
    const fileParts = validateFileParts(payload.files as Array<Record<string, unknown>>);
    const values = payload.values;
    if (values !== undefined && !Array.isArray(values)) throw new Error("values must be an array of {name, value, kind?}");
    const extra = values === undefined ? undefined : validateTypedValues(values);
    const result = await this.executeAction(this.actionFrom(action), { token, extraValues: extra, files: fileParts });
    this.pendingMutation = undefined;
    return result;
  }

  prepareMutation(action: string): { action: string; confirmationToken: string } {
    if (!(MUTATION_ACTIONS as readonly string[]).includes(action)) throw new Error(`Unknown mutation action: ${action}`);
    const confirmationToken = randomBytes(24).toString("hex");
    this.pendingMutation = { action, token: confirmationToken };
    return { action, confirmationToken };
  }

  async mutateList(action: string, token: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.pendingMutation || this.pendingMutation.action !== action || this.pendingMutation.token !== token) throw new Error("Invalid or expired mutation confirmation token; call prepare_mutation again.");
    if (!WHITELISTED_MUTATIONS.has(action)) throw new Error(`Mutation ${action} is not a whitelisted low-risk mutation; use the matching typed tool instead.`);
    validateListPayload(action, payload);
    const result = action === "create" ? await this.api.createCommodityList(payload)
      : action === "rename" ? await this.api.renameCommodityList(payload)
      : action === "delete" ? await this.api.deleteCommodityList(payload)
      : action === "add" ? await this.api.addCommodityToList(payload)
      : action === "remove" ? await this.api.deleteCommodityFromList(payload)
      : action === "move" ? await this.api.moveCommodityToList(payload)
      : action === "set_country" ? await this.api.setCountry(payload as { countryId: number })
      : action === "set_isic" ? await this.api.setIsic(payload as { isic: string })
      : action === "add_gift" ? await this.api.addGift(payload as { rangeIdsGiftCodes: Array<{ priceRangeId: number; giftCodes: string[] }> })
      : action === "add_order_service" ? await this.api.addOrderService(String(payload.orderItemId), Boolean(payload.enabled), Boolean(payload.selected))
      : action === "set_watchdog" ? await this.api.setWatchdog(payload as { commodityId: number; email: string; isTrackingStock: boolean; price?: number })
      : action === "send_feedback" ? await this.api.sendFeedback(payload as { text: string; email?: string; info: string })
      : action === "submit_discussion" ? await this.api.submitDiscussionPost(payload as { commodityId: number; msg: string; userEmail: string; anonymous: boolean; notifications: boolean; parentPostId?: number })
      : action === "rate_discussion" ? await this.api.rateDiscussionPost(Number(payload.postId), Boolean(payload.rating))
      : action === "coupon_add" ? await this.api.addCoupon(String(payload.coupon))
      : action === "coupon_remove" ? await this.api.deleteCoupon(String(payload.couponId))
      : action === "basket_update" ? await this.api.updateBasket(Number(payload.basket_id), Boolean(payload.flag), Boolean(payload.is_delayed_payment ?? false))
      : action === "basket_unlock" ? await this.api.unlockBasket()
      : action === "gdpr_export" ? await this.gdprExport(payload, token)
      : (() => { throw new Error(`Unsupported list mutation: ${action}`); })();
    this.pendingMutation = undefined;
    return result;
  }

  async cart(): Promise<unknown> {
    return { info: await this.api.cartInfo(), items: await this.api.cart() };
  }

  async addToCart(code: string, quantity = 1): Promise<unknown> {
    if (quantity < 1 || quantity > 99) throw new Error("quantity must be between 1 and 99");
    return this.api.addByCode(code, quantity);
  }

  async deliveryOptions(selectedDeliveryOptionId?: number): Promise<unknown> { return this.api.deliveryPaymentGroups(selectedDeliveryOptionId); }
  async selectAlzaBox(payload: Record<string, unknown>): Promise<unknown> { return this.api.deliveryAssociations(payload); }

  async previewOrder(selectedDeliveryOptionId?: number): Promise<MobileCheckoutPreview> {
    const checkoutState = await this.api.sendOrder1();
    const deliveryPaymentGroups = await this.api.deliveryPaymentGroups(selectedDeliveryOptionId);
    const preview = { cart: await this.cart(), deliveryPaymentGroups, checkoutState, confirmationToken: randomBytes(24).toString("hex") };
    this.pending = preview;
    return preview;
  }

  async submitOrder(token: string, deliveryPayment: Record<string, unknown>, userInfo: Record<string, unknown>, completeOrder: Record<string, unknown>): Promise<unknown> {
    if (!this.pending || this.pending.confirmationToken !== token) throw new Error("Invalid or expired confirmation token; call checkout_preview again.");
    const selected = await this.api.sendOrder2(deliveryPayment);
    const user = await this.api.sendOrder3(userInfo);
    const approved = await this.api.approveOrder4();
    const finished = await this.api.finishOrder(completeOrder);
    this.pending = undefined;
    return { selectedDeliveryPayment: selected, userInfoResult: user, approval: approved, orderFinished: finished };
  }
}
