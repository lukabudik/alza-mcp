import { z } from "zod";

/**
 * Per-tool `outputSchema` (audit docs/mcp-best-practices-audit.md F-06c → N-1,
 * implemented 2026-09-13).
 *
 * Design contract, recorded with the audit:
 * - The schema describes the STABLE top-level shape the tool is guaranteed to
 *   return, not the deep per-operation data shapes (those stay dynamic — the
 *   2026-09-10 audit judged per-operation schemas disproportionate).
 * - Raw upstream tools (the account/mobile stack) all return the Alza
 *   envelope: `err` 0/1/113 (number) — or an HTML error-page string in one
 *   2026-09-09 capture — `msg` string-or-null, `data`, plus operation-specific
 *   top-level keys (basket, items, form, …). Hence `passthrough`.
 * - Typed tools get their fixed shape (auth_start, prepare_mutation,
 *   account_status, checkout_preview, web_pickup_places, the 5 catalog tools).
 * - The TS SDK (1.29) validates every successful call's `structuredContent`
 *   against this schema; error results (`isError: true`) are exempt, so the
 *   errorWrap path (which carries no structuredContent) stays valid.
 * - Schemas are published on tools/list via zod-to-json-schema (JSON Schema
 *   2020-12, per SEP-2106 in the 2026-07-28 spec revision).
 */

/** Raw Alza upstream envelope — the shape every raw tool's response shares. */
export const ENVELOPE = z
  .object({
    /** 0 = ok; 1 = Alza-side validation failure (see msg); 113 = the documented gate retry; an HTML error-page string has been observed in one capture. */
    err: z.union([z.number(), z.string(), z.null()]).optional(),
    /** Alza-side validation message when err === 1; null on success. */
    msg: z.union([z.string(), z.null()]).optional(),
    /** Operation-specific payload — deliberately opaque (any JSON value). */
    data: z.unknown().optional(),
  })
  .passthrough()
  .describe(
    "Raw Alza envelope. err 0/1/113 (number; an HTML error-page string was observed once), msg string-or-null, data plus operation-specific top-level keys (e.g. basket, items, form).",
  );

/** `auth_discovery` result — the raw OIDC discovery document, not an envelope. */
export const AUTH_DISCOVERY = z
  .object({
    issuer: z.string().optional(),
    authorization_endpoint: z.string().optional(),
    token_endpoint: z.string().optional(),
    jwks_uri: z.string().optional(),
    grant_types_supported: z.array(z.string()).optional(),
    code_challenge_methods_supported: z.array(z.string()).optional(),
  })
  .passthrough()
  .describe("Raw OpenID Connect discovery document served by the Alza authority (issuer, authorization_endpoint, token_endpoint).");

/** `auth_start` result (OAuth start). */
export const AUTH_START = z
  .object({
    /** Full browser sign-in URL to open for the user. */
    authorizationUrl: z.string(),
    /** OAuth state to pass back to `auth_exchange`. */
    state: z.string(),
  })
  .passthrough();

/** `prepare_mutation` result — the one-time confirmation token binding. */
export const PREPARE_MUTATION = z
  .object({
    /** The exact mutation action the token is bound to. */
    action: z.string(),
    /** Single-use token; pass as confirmation_token on the matching tool. */
    confirmationToken: z.string(),
  })
  .passthrough();

/** `account_status` result — local process state, no network call. */
export const ACCOUNT_STATUS = z
  .object({
    /** Whether a mobile API access token is loaded in this process. */
    authenticated: z.boolean(),
    /** Alza visitor id (empty when unauthenticated). */
    visitorId: z.string(),
    /** Mobile API base URL in use. */
    apiBaseUrl: z.string(),
  })
  .passthrough();

/** `checkout_preview` result (read-side of the mobile checkout). */
export const CHECKOUT_PREVIEW = z
  .object({
    /** Full cart envelope as served by basketInfo. */
    cart: z.unknown().optional(),
    /** Delivery/payment groups as served by getDeliveryPaymentGroups. */
    deliveryPaymentGroups: z.unknown().optional(),
    /** Checkout state (sendOrder1 response). */
    checkoutState: z.unknown().optional(),
    /** One-time token that `place_order` requires. */
    confirmationToken: z.string(),
  })
  .passthrough()
  .describe("Read-side checkout: cart + delivery/payment groups + checkout state, plus the one-time token place_order requires.");

/** `order_search` result (OR6, 2026-09-22) — the HATEOAS search response:
 * `orders[]` (with `documents[]` invoice refs) + `commodities[]`. */
export const ORDER_SEARCH = z
  .object({
    self: z.unknown().optional(),
    orders: z.array(z.record(z.string(), z.unknown())).optional(),
    commodities: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough()
  .describe("Order search results: matching orders (status, phase, price, documents[]) and commodities.");

/** `order_archive` result (OR7, 2026-09-24) — the HATEOAS archive section:
 * `value[]` orders (same shape as the search results) + `paging`. */
export const ORDER_ARCHIVE = z
  .object({
    self: z.unknown().optional(),
    paging: z.unknown().optional(),
    value: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough()
  .describe("Archived orders: `value[]` (status, phase, price, documents[]) with `paging` (use `paging.next` for the next page).");

/** `product_by_ean` result (AT3, 2026-09-24) — the EAN-lookup envelope:
 * `data` on a match, or `err:1` + `msg` (\"No products found.\") when no
 * catalog product carries the scanned code. */
export const PRODUCT_BY_EAN = z
  .object({
    /** The matching product data (present on a catalog hit). */
    data: z.unknown().nullable().optional(),
    /** Alza `BaseResponse` error flag (0 = ok, 1 = not found). */
    err: z.number().int().optional(),
    /** Alza `BaseResponse` message (e.g. "No products found."). */
    msg: z.string().nullable().optional(),
  })
  .passthrough()
  .describe("Barcode/EAN product lookup: matching product data, or err:1 'No products found.' for unknown codes.");

/** `gdpr_info` result (A17, 2026-09-22). */
export const GDPR_INFO = z
  .object({
    /** The `PersonalGdprDetails` section (`gdprInfoAction`, `deleteAccountAction`). */
    personalDetails: z.unknown().optional(),
    /** The `AccountGdprDialog` (`emailInfo`, `sendGdprInfoForm`), or an error object when the dialog read failed. */
    gdprDialog: z.unknown().optional(),
  })
  .passthrough()
  .describe("GDPR section + export dialog (where the data export will be sent).");

/** `order_document` result (OR10, 2026-09-22) — downloaded document content. */
export const ORDER_DOCUMENT = z
  .object({
    name: z.string().nullable().optional(),
    /** The validated server-provided href that was fetched. */
    href: z.string(),
    contentType: z.string().nullable(),
    byteLength: z.number().int(),
    /** UTF-8 body when the content is text-like (JSON/XML/text). */
    text: z.string().nullable().optional(),
    /** Base64 body for binary content (PDF and friends). */
    base64: z.string().nullable().optional(),
  })
  .passthrough()
  .describe("Downloaded order document: metadata plus text or base64 content (max 8 MiB).");

/** Account credential/identity mutation results (A14–A18, 2026-09-22). These tools
 * return the Alza upstream envelope on success, or a small confirmation object when
 * the upstream body is empty. */
export const ACCOUNT_MUTATION = z
  .object({
    /** Present when Alza returns the standard envelope (err/msg/data). */
    err: z.union([z.number(), z.string(), z.null()]).optional(),
    msg: z.union([z.string(), z.null()]).optional(),
    data: z.unknown().optional(),
    /** Confirmation keys emitted when the upstream body was empty. */
    changed: z.boolean().optional(),
    enabled: z.boolean().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .passthrough()
  .describe("Account credential/identity mutation (A14–A18): the Alza envelope on success, or a confirmation flag when the upstream body is empty.");

/** `web_pickup_places` result (W11–W14 family). */
export const WEB_PICKUP_PLACES = z
  .object({
    /** Availability form (W11). */
    form: z.unknown().optional(),
    /** Paginated place list (W12). */
    places: z.unknown().optional(),
    /** Single-place detail (W14) — only when place_id was passed. */
    detail: z.unknown().optional(),
  })
  .passthrough();

/* ---------------- Catalog domain shapes ---------------- */

const PRODUCT_PARAM = z
  .object({ name: z.string(), value: z.string() })
  .passthrough();

const PRODUCT = z
  .object({
    code: z.string(),
    id: z.number(),
    name: z.string(),
    url: z.string(),
    image: z.string().optional(),
    price: z.number().optional(),
    originalPrice: z.number().optional(),
    currency: z.string(),
    availability: z.string().optional(),
    rating: z.number().optional(),
    brand: z.string().optional(),
    category: z.string().optional(),
    params: z.array(PRODUCT_PARAM).optional(),
  })
  .passthrough()
  .describe("Scraped product detail (JSON-LD sourced; stable fields listed, rest passthrough).");

export const SEARCH_PRODUCTS_OUTPUT = z
  .object({
    query: z.string(),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    products: z.array(PRODUCT),
    /** Present when a client-side price/rating sort swept multiple pages. */
    candidatesScanned: z.number().optional(),
  })
  .passthrough();

export const GET_PRODUCT_OUTPUT = z
  .object({ product: PRODUCT })
  .passthrough();

export const GET_PRODUCT_REVIEWS_OUTPUT = z
  .object({
    code: z.string(),
    ratingAverage: z.number().optional(),
    reviewCount: z.number().optional(),
    reviews: z.array(
      z
        .object({
          author: z.string().optional(),
          date: z.string().optional(),
          rating: z.number().optional(),
          body: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const LIST_CATEGORIES_OUTPUT = z
  .object({
    categories: z.array(
      z
        .object({
          id: z.number(),
          name: z.string(),
          url: z.string().optional(),
          parentId: z.number().optional(),
          childCount: z.number().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const FIND_PICKUP_POINTS_OUTPUT = z
  .object({
    points: z.array(
      z
        .object({
          type: z.union([z.literal("alzabox"), z.literal("branch")]),
          id: z.string(),
          name: z.string(),
          address: z.string(),
          city: z.string(),
          postalCode: z.string().optional(),
          latitude: z.number().optional(),
          longitude: z.number().optional(),
          distanceKm: z.number().optional(),
          openingHours: z.string().optional(),
          note: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const LIST_CATEGORY_FILTERS_OUTPUT = z
  .object({
    category_id: z.number(),
    groups: z.array(
      z
        .object({
          paramId: z.number(),
          name: z.string(),
          renderType: z.string(),
          filterable: z.boolean(),
          values: z.array(
            z
              .object({
                valueId: z.number(),
                description: z.string(),
                count: z.number().optional(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Map tool name → its output schema. Kept in one place so the registration
 * contract test can assert coverage per tool. */
export const OUTPUT_SCHEMAS: Record<string, z.AnyZodObject> = {
  // Catalog (typed domain shapes)
  search_products: SEARCH_PRODUCTS_OUTPUT,
  get_product: GET_PRODUCT_OUTPUT,
  get_product_reviews: GET_PRODUCT_REVIEWS_OUTPUT,
  list_categories: LIST_CATEGORIES_OUTPUT,
  find_pickup_points: FIND_PICKUP_POINTS_OUTPUT,
  list_category_filters: LIST_CATEGORY_FILTERS_OUTPUT,
  // Account (typed)
  auth_start: AUTH_START,
  prepare_mutation: PREPARE_MUTATION,
  account_status: ACCOUNT_STATUS,
  checkout_preview: CHECKOUT_PREVIEW,
  web_pickup_places: WEB_PICKUP_PLACES,
  // Account (raw envelope)
  auth_discovery: AUTH_DISCOVERY,
  auth_exchange: ENVELOPE,
  mobile_read: ENVELOPE,
  mutate_list: ENVELOPE,
  cart: ENVELOPE,
  add_to_cart: ENVELOPE,
  delivery_options: ENVELOPE,
  select_pickup_point: ENVELOPE,
  place_order: ENVELOPE,
  web_add_to_cart: ENVELOPE,
  chat_navigation: ENVELOPE,
  chat_send: ENVELOPE,
  web_cart: ENVELOPE,
  profile: ENVELOPE,
  contacts: ENVELOPE,
  register: ENVELOPE,
  address_upsert: ENVELOPE,
  address_delete: ENVELOPE,
  address_search: ENVELOPE,
  payment_methods: ENVELOPE,
  after_order_payments: ENVELOPE,
  pay_after_order: ENVELOPE,
  order: ENVELOPE,
  review_submit: ENVELOPE,
  complaint_claims: ENVELOPE,
  subscription_overview: ENVELOPE,
  subscription_activate: ENVELOPE,
  subscription_update_installment: ENVELOPE,
  web_place_order: ENVELOPE,
  cancel_order: ENVELOPE,
  web_pay_after_order: ENVELOPE,
  upload_attachment: ENVELOPE,
  // Read-side dynamic-action wrappers (2026-09-22, task-5)
  order_search: ORDER_SEARCH,
  order_archive: ORDER_ARCHIVE,
  product_by_ean: PRODUCT_BY_EAN,
  gdpr_info: GDPR_INFO,
  claim_detail: ENVELOPE,
  order_document: ORDER_DOCUMENT,
  // account credential/identity mutations (2026-09-22, task-6)
  change_password: ACCOUNT_MUTATION,
  two_factor_set: ACCOUNT_MUTATION,
  phone_change: ACCOUNT_MUTATION,
  email_change: ACCOUNT_MUTATION,
  delete_account: ACCOUNT_MUTATION,
};
