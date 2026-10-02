# Alza API gap analysis (2026-09-08)

Prioritized list of every unmapped gap / missing feature found across the
**mobile surface** and the **web checkout APIs** (new-goal scope), from:
the latest-APK re-audit (task 1), the `m.alza.cz` React checkout capture
(task 2), the WCF/REST family completion (task 3), and the mobile-pipeline
gap re-verification (task 4). Sources of truth:
`docs/mobile-endpoint-coverage.md` (rows + labels) and `docs/live-evidence/`
(dated records). Priority = user value × feasibility inside the MCP security
boundary (no new transports, typed + validated + one-time-token flows only).

## P0 — close end-to-end (top-priority implementation set)

### G1. Typed exposure of the verified web order + payment pipeline (closes O5/O11)

- **The gap:** the only *working* order-submission path on Alza today is the
  legacy web WCF chain (`SaveOrder2 → SaveOrder3 → SaveAndConfirmOrder2
  (113-gate retry) → CheckOrder4 → SendOrder4`), live-verified twice
  (2026-09-06 real order + 2026-09-08 re-checks). It is *documented* (O11,
  W16, PA8–PA10) but **not exposed as a typed tool** — the mobile typed
  `alza_place_order` is blocked at `sendOrder3` (HTTP 500, G3). Same for the
  after-order payment: the web `CreateAfterPayment` (PA9) executed a real
  payment (MojePlatba → KB SSO) but is documented-only.
- **Why P0:** this is the difference between "MCP can talk about orders" and
  "MCP can place and pay for a real order end-to-end through typed,
  validated, token-guarded tools."
- **Implementation (task 6):**
  - `alza_web_place_order` (high-impact, one-time token from
    `alza_prepare_mutation`): explicit inputs — delivery group/delivery/
    parcel-shop, payment method, user-info block (validated subset of the
    O11 `SaveOrder3` DTO: name, street, city, zip, phone, email,
    countryId), consents. Server-side flow: `SaveOrder2` (with
    `alzaPlusSubscriptionId:0`/`cetelemLeasingId:0` gate-skip) →
    `SaveOrder3` → `SaveAndConfirmOrder2` (auto-retry once on
    `ErrorLevel:113`, the documented AlzaPlus promo gate) → `CheckOrder4` →
    `SendOrder4`; returns the created order id + `GetOrderDetailAction`
    hash link.
  - `alza_web_pay_after_order` (high-impact, one-time token):
    `GetAfterPaymentDialog` (method list, read) + `CreateAfterPayment`
    execution with a validated `paymentId` from the dialog; returns the
    gateway hand-off (e.g. KB SSO URL) — the recorded MojePlatba flow.
  - Whitelist additions to `alza_prepare_mutation`:
    `web_place_order`, `web_after_order_payment` (high-impact set).
  - Unit tests for input validation + the 113-retry logic (mocked
    transport); live verification (task 7) on the real account with a
    minimal-cost order + real after-payment, final states recorded.

### G2. Flip the typed delivery/payment tools from v12 to v13 (closes D1)

- **The gap:** app 2026.17 (latest release) calls
  `getDeliveryPaymentGroups` **v13**; v12 is served in parallel. The typed
  tools (`alza_delivery_options`, `alza_payment_methods`) and the
  `delivery_payment_groups` read path still call **v12**. Both versions are
  live (re-verified 2026-09-07 *and* 2026-09-08).
- **Why P1:** small, safe, keeps the typed surface current with the app;
  the v13 response models add the 2026.17 server-driven action fields
  (`afterSelectAction`/`afterDeselectAction`, `Payment.isConditionalFreeDelivery`,
  `CardPayment.hideStoredPaymentCards`) that the response pass-through should
  carry.
- **Implementation (task 6):** route flip in the typed tools + whitelist
  entry (v13 kept as a fallback if v13 404s), unit tests, live re-check.

### G3. Web pickup-point family tool (closes W11–W14)

- **The gap:** the new HATEOAS web pickup family
  (`/api/personalPickup/v1/pickupPlaceForm|points|places|places/{id}`,
  live-mapped task 2) is the pickup surface of the *current* web checkout.
  The mobile `find_pickup_points` / `alza_select_pickup_point` cover the
  mobile equivalents only; the web family is documented but not exposed.
- **Why P1:** read-only, no token needed, directly usable for web-checkout
  delivery selection (pairs with G1: the `parcelShopId`/`deliveryId` that
  `alza_web_place_order` needs come from this tool's responses).
- **Implementation (task 6):** typed `alza_web_pickup_places` (read, no
  token) — inputs: optional type filter, latitude/longitude, paging;
  returns the form (type availability) + list + place detail (deliveryId,
  parcelShopId, isFree, typeText, openingHours). Origin-validated
  (www/m.alza.cz), explicit input validation, unit tests, live re-check.

## P1 — close next (documented, deferred in this goal)

### G4. HATEOAS web cart family (W3/W4/W5) — **implemented 2026-09-09**

`checkout/cart`, `checkout/cart/items`, `POST basket/v1/items` (HATEOAS
`appAction` responses). Implemented as two typed tools: **`alza_web_add_to_cart`**
(commodity_id + count → POST `basket/v1/items`; extracts the basket id from the
response's `order/{basketId}/item/{itemId}` link; the basket is visitor-keyed and
the cookie-less add with a Balancer-Guid header was live-verified 2026-09-09) and
**`alza_web_cart`** (basket_id → the W3 cart state + W4 item list). Unit-tested
(exact body, exact routes, validation); live evidence
`docs/live-evidence/gap-fix-probe-2026-09-09.json` + `gap-fix-probe3-2026-09-09.json`.

### G5. Mobile `sendOrder3` HTTP 500 (O3) — server-side

Re-confirmed 2026-09-06, 2026-09-08 **and** 2026-09-09 (full + empty `Parameters`,
authenticated + guest): `POST /services/restservice.svc/v5/sendOrder3` →
HTTP 500 `InternalServerError` (2026-09-09: fresh basket → sendOrder2 err:0 →
sendOrder3 500, same shape). Nothing the MCP can fix server-side; the
practical closure is G1 (typed web pipeline). Kept `unresolved`; the typed
mobile `alza_place_order` stays live-reached/blocked with the documented
500. **Re-test cadence:** each live-verification run (cheap: one POST).

### G6. Mobile after-order `err:1` for WCF-created orders (PA2/PA3)

Re-confirmed 2026-09-08 **and** 2026-09-09 against still-open order 1056808137
(`getafterorderpayments` → “Faktura se zadaným ID neexistuje”;
`afterOrderPayment` → “Aktualizujte prosím aplikace"). Expected until a
restservice-pipeline order exists (i.e. until G5's 500 is fixed
server-side). The web `CreateAfterPayment` (G1's `alza_web_pay_after_order`)
is the working execution path in the meantime.

## P2 — candidates (status: two implemented 2026-09-09, the rest confirmed documented-only)

| Candidate | Evidence | Note |
|---|---|---|
| Chatbot family (`chatbotapi.alza.cz` `/v1/navigation`, `/v1/chat`, pageType-coded) | W18 (live 2026-09-08; **implemented 2026-09-09**) | Typed tools `alza_chat_navigation` + `alza_chat_send` (session-scoped, visitor-keyed, token-free like `alza_web_add_to_cart`). Live corrections: navigation requires the `country` query field, the chat POST requires `ListCategoryId` (empty array works), pageType codes 1=product detail / 5=Order1 / 6=Order2 / 24=Order4. Record: `docs/live-evidence/p2-implementation-2026-09-09.md` |
| Web telemetry (`logapi.alza.cz /api/log/v2/logs`, `metrics/gs/ccm/collect`, `cdn-cgi/rum`) | W19 (live 2026-09-08) | Out of scope by rule; only relevant as a transport note |
| `next-api/auth/get-session` (Next.js bootstrap) | W1 | Framework plumbing; no user value as a tool |
| 2026.17 server-driven action fields (`afterSelectAction`/`afterDeselectAction` on D1 items, `alzaPlusActionBannerAction`) | re-audit 2026-09-07; **scan 2026-09-09** | **No new API surface needed**: live scan with a real basket — 59 deliveries + 14 payments, 0 non-null actions (`alzaPlusActionBannerAction` null) — nothing to follow up on; documented-only in the coverage doc |
| Bank-app payment channel (PA11: `PayViaBankAppResolver`, preferred-bank-app preference) | re-audit 2026-09-07; **confirmed 2026-09-09** | Client-side UX over the same `paymentId` flow; no new API surface — stays documented-only (PA11) |
| `GetZipCodes` on `EShopService.svc` (WCF twin of D5) | probe 2026-09-08; **implemented 2026-09-09** | `web_zip_codes` whitelist op (`alza_mobile_read`): only the PascalCase `Search` body field binds (6 candidate fields probed); the response `Value` is an HTML snippet of `zip-item` divs; `ErrorLevel:14` when nothing matches. Record: `docs/live-evidence/p2-implementation-2026-09-09.md` |
| Device tokens, admin routes, news, prescriptions | earlier audit | Documented out-of-scope (see coverage doc) |

## Explicitly NOT gaps (closed this goal)

- **W16 Order2→3 trigger** — resolved to `SaveOrder2`/`SaveAndConfirmOrder2`
  (2026-09-08 probe: `LeaveOrder2`/`LeaveOrder3` are 404; the Save ops
  advance the WCF state machine).
- **WCF order+payment family completeness** — closed: 92 candidate
  operations probed, exactly 10 exist (probe record 2026-09-08).
- **APK route drift** — stable across 2026.15/16.1/17.0 except the D1
  version bump (→ G2).
- **OAuth client-secret** — decoded, wired, overridable (previous goal).

## Implementation record (task 6, 2026-09-08)

**G2 — implemented.** `MobileApi.deliveryPaymentGroups` now calls **v13** with an
HTTP-404-only fallback to v12 (`src/infra/mobile-api.ts`). Serves
`alza_delivery_options`, `alza_payment_methods`, and `alza_checkout_preview`
automatically. Unit-tested (v13 direct, v13→v12 fallback, no fallback on 500).

**G3 — implemented.** New typed read tool **`alza_web_pickup_places`** (no token):
inputs `order_id?/group_id?/latitude?/longitude?/types[]?/limit?/offset?/place_id?`;
returns `{form, places, detail?}` from the `personalPickup/v1` family
(`webPickupPlaceForm` / `webPickupPlaces` / `webPickupPlaceDetail` in
`MobileApi`, validation in `MobileAccount.webPickupPlaces`). Unit-tested
(input validation + exact routes).

**G1 — implemented.**
- **`alza_web_place_order`** (high-impact, one-time token `web_place_order`):
typed inputs (delivery/group/parcel-shop, payment, user-info block with
email/zip/phone/consent validation); runs `SaveOrder2` (with
`alzaPlusSubscriptionId:0`/`cetelemLeasingId:0` gate-skip) → `SaveOrder3` →
`SaveAndConfirmOrder2` (auto-retry once on `ErrorLevel:113`, the documented
AlzaPlus promo gate) → `CheckOrder4` → `SendOrder4`; throws on any non-zero
`ErrorLevel`; returns `order_id` + `order_detail_link` (GetOrderDetailAction
webLink) + per-step `error_levels`. WCF `d`-envelope unwrapped in
`MobileApi.webWcfStep`.
- **`alza_web_pay_after_order`** (high-impact, one-time token
  `web_after_order_payment`): typed inputs (order_id, payment_id, order_hash?,
  invoice_id?, price?); runs the recorded `CreateAfterPayment` body (the
  2026-09-06 real-payment shape); returns the gateway hand-off result.
- Read companion: `alza_mobile_read` operation **`web_after_payment_dialog`**
  (WCF `GetAfterPaymentDialog`, PA8) — token-free method list for an unpaid order.
- `alza_prepare_mutation` now accepts `web_place_order` + `web_after_order_payment`
  (high-impact set 9→11).
- Unit-tested: full chain happy path incl. the 113-retry, exact WCF bodies
  (SaveOrder2/3 + SendOrder4), non-zero-step failure, single-use token, after-
  order payment body + validation, dialog read route.

All three: `npm test` 60/60, `npm run typecheck`, `npm run build`,
`git diff --check` green (2026-09-08).

**Live verification (task 7, 2026-09-08 — done):** real minimal-cost order
**1057075103** (book FKP0383232, 35 CZK + AlzaBox 2680/1128203, 104 CZK
ex-VAT) created through the exact `alza_web_place_order` WCF chain on the
registered E2E account (user_id 100000001); the `web_after_payment_dialog`
read returned the live after-order method list (213/216/219/143/144/203),
and `alza_web_pay_after_order` (`CreateAfterPayment` 144 MojePlatba) returned
`ErrorLevel:0` with the gateway hand-off
`https://www.alza.cz/Secure/MojePlatba-aop.htm?aop=1325060564`. Final order
state recorded (“Objednávku jsme přijali”, phase 3). Two live findings
folded back into the implementation: the `SendOrder4` top-level `OrderId`
field is 0 (order id now derived from `GetOrderDetailAction`, unit-tested),
and the 113-gate step can also answer with a transient HTTP 404 that leaves
the WCF state valid (the retry covers the documented 113 case). Record:
`docs/live-evidence/web-tool-e2e-2026-09-08.md` (+ 2 JSON captures).

## Implementation record (round 2, 2026-09-09 — remaining-gaps sweep)

After the 2026-09-08 goal closed, a fresh triage of `docs/mobile-endpoint-coverage.md`
+ this report found four actionable items; all are now closed:

- **G4 (above)** — `alza_web_add_to_cart` + `alza_web_cart` typed tools; the
  basket add is visitor-keyed (cookie-less Balancer-Guid add live-verified), so
  the tools work with the standard MCP transport. `webCart` needs only the
  basket_id (the `visitors/{visitorId}` path segment is not validated
  server-side — a placeholder UUID returned the same cart).
- **C12 resolved** (the last `unresolved` catalog row): the C11 navigation
  response carries the full carousel route
  `GET /api/catalog/v1/homePage/categories/{id}?pgri=…&ui=…` (bare route → HTTP
  400; with the server-provided params → 200 `{self, breadcrumbs, name, value,
  disclaimers, shareWebLink}`). Exposed as the `home_categories` read op on
  `alza_mobile_read` (39 read ops now).
- **G5/G6 re-tested 2026-09-09** (above) — both unchanged; they stay
  server-side `unresolved` with a per-run re-test cadence.
- **Found & fixed during the round:** the `web_after_payment_dialog` read op
  (added 2026-09-08) was missing from the `alza_mobile_read` zod enum — the op
  existed in the domain layer but was unreachable through the tool. Now in the
  enum (39 ops).

Not actionable (unchanged): AT3 (vision API — no static route), the P2 table
(boundary/server-side), and the mobile `alza_place_order` path blocked at G5.
Gate: `npm test` 63/63, `npm run typecheck`, `npm run build`, `git diff --check`
green (2026-09-09). Live records: `docs/live-evidence/gap-fix-probe-2026-09-09.json`,
`docs/live-evidence/gap-fix-probe3-2026-09-09.json`.

## Blocker matrix (2026-09-16) — full blocked/unresolved classification

Goal contract (goal mu3orcal-hqvsbi): close **every** `blocked`/`unresolved` row in
`docs/mobile-endpoint-coverage.md` (main tables + dynamic-action registry). Each row
below gets exactly one class — the resolution path this goal commits to:

- **fix-attempt** — deep probe/fix work runs (operational blockers get byte-level
  replication of the latest released APK's exact request before anything is called
  server-side). Terminal state: *fixed* (typed implementation + unit tests + live
  evidence) or *server-side-conclusive* (fresh dated re-test evidence + the per-run
  re-test cadence kept, row stays `unresolved`).
- **typed-wrapper-candidate** — a typed tool / `alza_mobile_read` op within the MCP
  security boundary (static route, explicit input validation, one-time token on
  high-impact mutations, origin validation). Terminal state: implemented +
  live-verified, or an explicit dated rationale for staying blocked recorded on the row.
- **policy-blocked** — stays blocked with recorded rationale (external-origin hand-off,
  credential/irreversible boundary, no static route, server-driven no-op). The row is
  documented, never silently omitted.
- **server-side-suspect** — the blocker looks like Alza's server; probed deeply first,
  then the terminal state per `fix-attempt`.

| Row(s) | Operation / action | Class | Task | Notes |
|---|---|---|---|---|
| O3 (G5) | mobile `sendOrder3` HTTP 500 — blocks typed `alza_place_order` step 2 (and O5) | fix-attempt (server-side-suspect) | task-2 | **terminal: server-side-conclusive (2026-09-16, `docs/live-evidence/g5-g6-or11-retest-2026-09-16.md`)** — byte-level app request from APK 2026.17.0 replayed live: the 500 reproduced across UA versions 2026.15/456 + 2026.17/459 + future 2026.18/460 + the MCP control UA; body shapes full/guest/empty/email/`dEmail`; fresh-basket pipeline state (getUserData → basket/add → sendOrder1 → v13 groups → sendOrder2 all 200 err:0, resolved delivery group); registered + guest; and **both hosts `www.alza.cz` and `m.alza.cz`** (the APK host-resolution chain `h31.d()` → `uek.g()` → `u5j` join proves the app's production-mobile API host is **m.alza.cz** — new documented fact, row O3 updated). UA-independent, body-shape-independent, host-independent, auth-independent, pipeline-state-independent → row stays `unresolved`, per-run re-test cadence kept |
| PA2/PA3 (G6) | mobile after-order options + execution `err:1` on WCF-created orders | fix-attempt (server-side-suspect) | task-3 | **terminal: server-side-conclusive (2026-09-16, `docs/live-evidence/g5-g6-or11-retest-2026-09-16.md`)** — re-tested against cancelled order 1058423434 with the exact app UA 2026.17/459: `err:1` persists across UA variants (app UA vs control), auth variants (Bearer/no-Bearer), paymentIds 103/144 and order states (cancelled → messages “Objednávka se zadaným ID neexistuje” (PA2) / “Objednávka nebyla nalezena” (PA3); the still-open 2026-09-08 run had “Faktura se zadaným ID neexistuje” / “Aktualizujte prosím aplikace”). **Not an app-version gate**; `v3`/`v5` (PA2) and `v5` (PA3) bumps → HTTP 404 (the APK string pool carries exactly `v2`/`v4`). PA3 fired only under the PA2-err:1 safety gate — no charge possible. Rows stay `live-verified` with the documented limitation |
| OR11 (2026-09-15 anomaly) | order cancellation — 2026-09-15 re-test got `null` responses + “Zpracováváme změny” (2026-09-06 runs were 202 Accepted) | fix-attempt | task-4 | **terminal: resolved (2026-09-16, `docs/live-evidence/or11-cancel-retest-2026-09-16.json` + `or11-cancel-followup-2026-09-16.json`)** — the “null” was **202 Accepted with an empty body** (async cancellation accepted); the cancellation had taken effect (the order re-read showed “Objednávka byla zrušena”, phase 4, unlocked); re-issuing the PUT is idempotent-safe (re-submits, re-enters “Zpracováváme změny”, resolves back to cancelled). No implementation change needed — row OR11's 202-accepted semantics stand; the authenticated `GET /api/v1/orders/{id}` detail route 404s on the WCF port-1002 service (the anonymous read is the working detail route) |
| A17 | GDPR data export link (read) | typed-wrapper-candidate | task-5 | **terminal: fixed (2026-09-22, `docs/live-evidence/task5-a17-or6-or10-k2-2026-09-22.md`)** — typed `gdpr_info` read (personalDetails 200 with `gdprInfoAction`+`deleteAccountAction`; gdprDialog 200, `emailInfo` = E2E login email) + `gdpr_export` low-risk mutation (POST `gdprInformation` → **202 Accepted**); unit tests in `test/task5-actions.test.ts`; row now `live-verified` |
| OR6 | order search (read) | typed-wrapper-candidate | task-5 | **terminal: fixed (2026-09-22, same record)** — typed `order_search`: `POST /api/users/{userId}/v1/orders/search/results?country=CZ` with `{searchTerm, productFilterType:0}` (form-urlencoded per the APK form; `searchTerm` required — 400 without) → 200 with `orders[]` + invoice `documents[]`; row now `live-verified` |
| OR10 | invoice/document download (read, origin-validated) | typed-wrapper-candidate | task-5 | **terminal: fixed (2026-09-22, same record)** — typed `order_document`: follows `Document.self.href` (HTTPS-only, Alza-host allowlist incl. `pdf.alza.cz`, max 8 MiB, non-allowlisted redirects blocked); live invoice → 200 `%PDF-1.7` 332,276 bytes; row now `live-verified` |
| K2 | claim/complaint detail (read) | typed-wrapper-candidate | task-5 | **terminal: fixed (2026-09-22, same record)** — typed `claim_detail` (per-claim `detailAction` via the AppAction executor, same pattern as K1; unit-tested). Dated deferral on live execution: E2E account 100000001 has zero claims (`warrantyClaims/active`+`/archive` → 200 empty, 2026-09-22) so no claim exists to detail; row `source-confirmed` with the rationale on it |
| K3 | complaint guide (return flow) | typed-wrapper-candidate (deferred) | task-5/6 boundary at execution | multi-step server-form flow, same executor pattern as K1/K4; **not named in the confirmed task list** — raise with the user before adding |
| PA4 | Box2Box payment order-detail action (read-ish detail) | typed-wrapper-candidate (conditional) | task-5 | **dated rationale (2026-09-22)**: reachable only on Box2Box order models; the standing E2E account holds no Box2Box orders (order inventory: 1056808137 AlzaBox, 1058423434 WCF) — reachability unverifiable without a Box2Box purchase; stays `blocked` (documented in the dynamic-action registry) until a Box2Box order exists |
| A14 | change password (credential mutation) | typed-wrapper-candidate | task-6 | **terminal: typed + live-verified-to-step-up (2026-09-23)** — `change_password` (one-time token; new ≥ 8 chars, confirm match, ≠ old) over static route `POST /v2/account/password {oldPassword, password1, password2}`; live on a **disposable** account: the commit sits behind Alza's SMS step-up (`second-factor/requests` → 200 `TwoFactorAuthSms`; wrong code → 400 `InvalidUnlockCode`); final code entry environment-blocked (re-test target) — `docs/live-evidence/task6-a14-a18-disposable-2026-09-23.md` |
| A15 | two-factor setup | typed-wrapper-candidate | task-6 | **terminal: typed + live-verified-to-step-up (2026-09-23)** — `two_factor_set` (boolean, JSON-Patch `path:/2faEnabled`); reversible (enable→disable); same SMS step-up gate; record as above |
| A16 | phone number update | typed-wrapper-candidate | task-6 | **terminal: typed + live-verified-to-step-up (2026-09-23)** — `phone_change` (JSON-Patch `path:/phone`) + bonus `email_change` (`path:/email`); exact 401 `identityTwoFactorAuthentication` gate reproduced live; record as above |
| A18 | delete account (irreversible) | typed-wrapper-candidate (guarded) | task-6 | **terminal: typed + live-verified-to-step-up (2026-09-23)** — `delete_account` (`DELETE /v1/account {acknowledgeAndDelete:true}`, `destructiveHint`, disposable-only policy); gate reproduced on disposable 100000002; 5 orphaned disposable accounts from the run are the gate's direct consequence; standing E2E account 100000001 never touched; record as above |
| R6 | product rating action | typed-wrapper-candidate | task-6 | **terminal: subsumed (rationale, 2026-09-24)** — `ratingAction` is the same WriteReview form family as R2; the typed `review_submit` already carries `rating` 1–5 + `text` (one-time token); row → `source-confirmed` (subsumed) |
| OR7 | order archive | typed-wrapper-candidate | task-6 | **terminal: fixed (2026-09-24)** — the `archiveOrders` navigation section is a **static read** (`GET /v1/orders/archive?hideCancelledOrders={bool}&productFilterType=0`, default include-cancelled per the APK form); typed `order_archive` (read, no token, optional limit 1–100); live 200 (both toggle variants, empty `value[]` + paging) on disposable 100000002; row → `live-verified` — `docs/live-evidence/task6b-remaining-candidates-2026-09-24.md` |
| OR8 | order data update / recalculation (high-impact) | typed-wrapper-candidate | task-6 | **terminal: blocked (dated rationale, 2026-09-24)** — `updateOrderDataAction`/`recalculationAction` absent from both standing orders (full action scan 2026-09-22: only claim-guide/careBox/chatbot); need a pending-order state, unreachable here (G5 blocks order creation); executor pattern would carry them; re-test target recorded |
| OR9 | cancel drop order (AlzaBox) (high-impact) | typed-wrapper-candidate | task-6 | **terminal: blocked (dated rationale, 2026-09-24)** — AlzaBox order 1056808137 is one-off/completed, no `cancelDropOrder` action; no active AlzaBox subscription (subscriptions 404) and none creatable without a payment-capable state; re-test target recorded |
| S5 | limit-exceeded repayment (charges card) | typed-wrapper-candidate | task-6 | **terminal: blocked (dated rationale, 2026-09-24)** — needs a **failed-installment** state; the standing account holds no subscription at all (subscriptions 404, 2026-09-22) → no installment, no failed installment; state unreachable; re-test target recorded |
| PA7 + registry `addToCartAction`/`commodityCodesCarouselAction` | quick-order payment (creates + pays) | typed-wrapper-candidate | task-6 | **terminal: blocked (dated rationale, 2026-09-24)** — `SubmitQuickOrder` needs a **stored payment method** (immediate charge); the standing E2E account and the 2026-09-24 disposable account hold none (PA1 = option groups only; no stored-card read route); the action is not offered without one; re-test target recorded |
| P7/P8/D6 | delivery variants/time-frames + personal-delivery scheduling forms | typed-wrapper-candidate | task-6 | **terminal: blocked (dated rationale, 2026-09-24)** — per-basket forms only on `canPickDeliveryTime=true` deliveries; live basket scan (64 delivery variants, disposable 100000002): **0** qualify (`showCourierTimeIntervalPicker` is a UI rule, not a form surface); static read already typed (`alza_delivery_options`); re-test target recorded |
| PA5 | Klarna hand-off | policy-blocked | — | leaves Alza origin (security boundary); rationale already on the row |
| PA6 | Google Pay | policy-blocked | — | external provider charge; rationale already on the row |
| PA11 | bank-app payment channel | policy-blocked | — | client-side UX over the same PA2/PA3/PA9 `paymentId` flow; no API surface |
| AT3 | vision (barcode/EAN product scan) | typed-wrapper-candidate (static route found on re-scan) | task-7 | **terminal: fixed (2026-09-24)** — APK 2026.17.0 re-scan: static route `POST /services/restservice.svc/v1/getProductByEANlist` in the dex string pool (request `ProductByEanRequest {eanList}`, response `ProductDetailEanResponse {data}`; packages `cz.alza.base.{api,lib,android}.vision`); typed `product_by_ean` (read, 1–20 barcodes); live probe: unknown EANs → 200 `err:1 "No products found."` (standard envelope; route up, DTO bound); positive `err:0` pending a stocked EAN (re-test target) — `docs/live-evidence/at3-vision-rescan-2026-09-24.md` |
| (registry) `UnavailableBasketProductsAction` / `UnavailableBasketAccessoriesAction` / `CheckVouchersUnusedBalanceInBasketAction` | LeaveOrder1 result follow-ups | policy-blocked | — | conditional server-provided follow-ups in specific basket states; no static route; typed web chain covers the mainline flow |
| (registry) `bankIdAuthApiAction` (CheckOrder4 response) | bank-identity hand-off | policy-blocked | — | external bank-origin hand-off |
| (registry) `GiveSharedLimitConsentAction` (SendOrder4 response) / `PaymentAction` (WCF envelope field) | server-driven hand-offs inside the typed chain's own responses | policy-blocked | — | conditional hand-offs; typed chain exposes the mainline pipeline |
| (registry) `alzaPlusActionBannerAction` | D1/OrderInfo banner action | policy-blocked | — | live scan: null across the real-basket run (documented-only) |
| (registry) `afterSelectAction` / `afterDeselectAction` (+ `paymentAfterSelectAction`/`paymentAfterDeselectAction`) | D1 select/deselect follow-ups | policy-blocked | — | 0 non-null across 59 deliveries + 14 payments (2026-09-09 scan); no surface warranted |

Registry dedup: `changePasswordAction`/`passwordAction`/`twoFactorAction`/`phoneNumberAction`/
`gdprInfoAction`/`deleteAccountAction`/`deleteUserAccountAction` = A14–A18;
`searchOrdersAction`/`archiveOrdersAction`/`updateOrderDataAction`/`recalculationAction`/
`cancelDropOrder`/`downloadAction` = OR6–OR10; `limitExceededRepaymentAction` = S5;
`v3/payment/getOrderDetailAction`/`KlarnaSession`/`GooglePayRequest`/`SubmitQuickOrder` =
PA4/PA5/PA6/PA7; `DeliveryVariantsActions`/`DeliveryTimeItemsWithForm`/`DeliveryHoursActions`/
personal-delivery actions = P7/P8/D6 — each classified once via its main row above.

Adjacent (not a blocked row, noted to avoid silent omission): B9 watchdog's persistent
creation is reversible only through the dynamic `WatchdogsParams.deleteAction` form
(row stays `source-confirmed`); if the user wants the delete wrapped, it folds into
task-6 the same way as OR9.

Classification counts: 21 main-table `blocked` rows + 2 `unresolved` rows (O3, AT3) +
the 2 G6 rows (PA2/PA3, labeled `live-verified` with a documented limitation) + the
OR11 anomaly + 6 registry-only entries = 32 entries, all classified; zero unclassified.
**Post task-5 (2026-09-22): 4 of the 21 main-table `blocked` rows closed** — A17/OR6/OR10 →
`live-verified` (typed `gdpr_info`+`gdpr_export`, `order_search`, `order_document`;
`docs/live-evidence/task5-a17-or6-or10-k2-2026-09-22.md`) and K2 → `source-confirmed`
(typed `claim_detail`; dated rationale: zero claims on the E2E account).
**Post task-6 (2026-09-23/24): 8 more rows closed** —
- A14/A15/A16/A18 → `live-verified` (typed `change_password`/`two_factor_set`/`phone_change`/
  `email_change`/`delete_account`; exact routes + DTOs + the SMS step-up chain live-verified on a
  disposable account; final 4-digit code entry environment-blocked — re-test target;
  `docs/live-evidence/task6-a14-a18-disposable-2026-09-23.md`)
- R6 → `source-confirmed` (subsumed by the typed `review_submit` rating flow, rationale 2026-09-24)
- OR7 → `live-verified` (typed `order_archive`; static read route, live 2026-09-24)
- AT3 → `live-verified` (typed `product_by_ean`; static route found on the 2026-09-24 APK
  re-scan; live envelope verified; `docs/live-evidence/at3-vision-rescan-2026-09-24.md`)
Remaining main-table `blocked` rows: **11** (P7, P8, K3, S5, D6, PA4, PA5, PA6, PA7, OR8, OR9)
— every one now carries an explicit dated rationale (2026-09-22/24) on the row + here:
- **policy-blocked** (external hand-offs, unchanged): PA5 (Klarna), PA6 (Google Pay)
- **reachability-gated, dated rationale + re-test target (2026-09-24)**: P7/P8/D6 (0 of 64
  live basket deliveries expose a time-frame form), S5 (no subscription → no failed
  installment), PA7 (no stored payment method), OR8 (neither action on the standing
  orders; pending-order state unreachable behind G5), OR9 (no active AlzaBox drop
  subscription); PA4 keeps its 2026-09-22 Box2Box rationale; K3 stays deferred (not
  named in the confirmed task list)

Operational note (2026-09-24): the standing E2E token is 401-gated on the www
`/api/users/{id}/v1/*` user services (token-age re-auth window; 1secmail inbox
sinkholed from this egress) — authenticated OR1/K1/OR6/OR7 reads on the standing
account need a fresh E2E login; the disposable account 100000002 is the working
authenticated identity for this batch (side finding in
`docs/live-evidence/task6b-remaining-candidates-2026-09-24.md`).

Security boundary applied throughout (unchanged from the 2026-09-08 goal): typed +
validated + one-time-token flows only; no new transports; external-origin hand-offs
stay blocked; origin validation on any download-style wrapper.

## Post-launch corrections from a real live E2E order (2026-09-26)

A real end-to-end run (search → compare → `add_to_cart` → `delivery_options` →
`web_place_order` → real order 1060090910 → cancelled) surfaced documentation
gaps that don't change which endpoints work, but were actively misleading
about *how* the working tools relate to each other:

- **`OR11` (order cancellation) closed**: now a typed tool, `cancel_order`
  (one-time token, `reason` 0–5), live-verified against the real order above
  (`PUT .../cancellations` → 202). Unit-tested.
- **Cart-pairing correction**: `web_place_order` submits the cart populated by
  `add_to_cart` (mobile `restservice.svc/v2/basket/add`), **not** the separate
  HATEOAS cart from `web_add_to_cart`/`web_cart` as four tool descriptions
  previously implied. Fixed in all four.
- **Anonymous-checkout discovery**: `add_to_cart`, `delivery_options`,
  `payment_methods`, and `checkout_preview` all succeed with **no OAuth
  token loaded** — they fall back to an anonymous, visitor-keyed WCF cart
  (`account_status` reports `authenticated: true` but `user_id: -1`). Only
  `checkout_preview`'s own submission path (`place_order` → mobile
  `sendOrder3`/`orderfinished`) is still broken (G1/G5); `web_place_order`
  against that same anonymous cart is the working submission path. This
  means the full search → cart → deliver → pay chain now works **without
  ever logging in**, which the AUTH_PREREQ boilerplate on those four tool
  descriptions didn't previously convey.
- **`find_pickup_points`/`web_pickup_places` AlzaBox scoping**: confirmed the
  live `personalPickup/v1/places`/`pickupPlaceForm` endpoints 400 without an
  `orderId`/`groupId` from an active cart+delivery-group — AlzaBox discovery
  is checkout-cart-scoped by the API itself, not merely unimplemented in this
  client. Docs now point at the working sequence
  (`add_to_cart` → `delivery_options` → parse the AlzaBox option's
  `deliveryOption.href` → `web_pickup_places`).
- **New physical-eligibility finding**: Alza excludes large items (observed:
  34"+ monitors, both a 40" and a 34" ultrawide tested) from the entire
  ~4000-locker AlzaBox network — not a distance/coverage gap, a structural
  exclusion. Those items route to a fixed set of 8 nationwide oversized-item
  pickup points instead. A 27" monitor routes normally to the full network
  (confirmed against a real box in Hradec Králové — Kukleny, "K Biřičce",
  0.68 km from the district center). No typed tool currently surfaces this
  eligibility before checkout; a `get_product`/`search_products` field would
  close it (recorded below as a new candidate, not yet a numbered gap).
- **`sendOrder3` 500 re-confirmed with more precision (2026-09-26)**: with a
  correctly-populated `deliveryGroups` (real `deliveryGroupId` from
  `delivery_options`, not the empty-array shape), `sendOrder3` itself
  returned `err:1` "Nebyl zvolen způsob dopravy a platby" (already-documented
  behavior for a mismatched/incomplete delivery selection, not the 500) —
  the 500 shows up downstream, either at `sendOrder3` in some states or at
  `orderfinished` (`/api/orders/v7/orderfinished`) in others. The underlying
  conclusion (G1/G5: the mobile submission path is broken server-side; use
  `web_place_order`) is unchanged, but the exact failing step is state-dependent
  rather than always `sendOrder3` — worth noting for anyone re-verifying G5.

### `list_categories` drill-down bug — found, not yet fixed (2026-09-27)

- **The gap:** `list_categories({parent_id: 18890188})` ("Počítače a
  notebooky") returned the same 21 top-level categories as
  `list_categories({})` with no `parent_id` — the subcategory drill-down
  appears to be broken, not just for this id (found while resolving the
  router category for a live filter-workflow test; had to fall back to
  resolving the category id from a product page's breadcrumb links
  instead). Not yet root-caused (could be the DOM selectors in
  `listCategories`'s extractor not matching this page's subcategory-list
  markup, or the URL construction). Recorded as a re-test/fix target, not
  investigated further this session to stay in scope.

### `get_product` spec-table scraping gap — closed (2026-09-27)

- **The gap:** found while live-verifying the "cheapest router with four 10
  Gbit ports" workflow. `get_product("Mikro25001")` (Mikrotik CRS304-4XG-IN)
  returned `params: undefined` — no spec data at all — even though Alza's own
  page clearly lists `Počet LAN portů s rychlostí 10 Gbit: 4`. The DOM
  `.paramTbl`/`.productSpecBox` selectors `PRODUCT_PAGE_EXTRACTOR` scrapes
  found nothing on this product's page template.
- **Root cause**: this product's specs render through the JSON-LD `Product`
  block's `additionalProperty` array (schema.org `PropertyValue[]`) instead
  of, or in addition to, the DOM table — a different page template than the
  one `.paramTbl` assumes. `getProduct` already parsed the full `Product`
  JSON-LD (`ld`) for name/price/rating/etc. but never read
  `ld.additionalProperty`.
- **Fix**: `pickAdditionalProperties` (`src/domain/catalog.ts`) extracts
  `{name, value}` pairs from `additionalProperty`; `getProduct` merges them
  with the DOM-scraped rows (DOM rows win on name collisions, capped at 30
  total, same as before). Live-verified: the router now returns 21 spec rows
  including the exact 10 Gbit port count; re-checked a product that already
  worked via the DOM table (40" MSI MAG401QR) to confirm no regression (still
  30 rows, unchanged). Unit-tested (`pickAdditionalProperties` in
  `test/catalog-sort.test.ts`).

### `select_pickup_point` re-test needed against an authenticated session

- **The observation (2026-09-26, anonymous session)**: `delivery_options`'
  delivery entries all carry null `beforeSelectAction`/`afterSelectAction` —
  there is no association form to copy, contradicting the tool's description
  ("copied verbatim from the `delivery_options` response"). Hand-crafting the
  `getDeliveryAssociations` payload from the pre-existing debug script
  (`scripts/debug-order-steps.mjs`) and calling `select_pickup_point` returned
  a `data` array shaped like a payment-fee list (`price`, `isLowCredit`,
  `paymentPrice` fields on ids matching known *payment* method ids like 103/
  143/144/203), not per-location AlzaBox associations.
- **Not yet resolved**: this may be specific to the anonymous fallback
  session (no real Alza login) — the server-driven association form might
  only populate for an authenticated cart. Re-test target: run the same
  sequence against a real authenticated session and see whether
  `beforeSelectAction` is populated.
- **Workaround that works today**: the live-verified
  `add_to_cart` → `delivery_options` → `web_pickup_places` (parsing
  `orderId`/`groupId` from the AlzaBox option's `deliveryOption.href`) →
  `web_place_order` (with `parcel_shop_id` from `web_pickup_places`) chain
  places a real AlzaBox order without needing `select_pickup_point` at all —
  this is what should be recommended until the above is re-tested.

### Search-time attribute/facet filtering — closed for Checkbox-type facets (2026-09-27)

- **The gap:** Alza's category pages have a rich per-category attribute filter
  system (facets) — e.g. screen diagonal, native contrast, panel technology,
  refresh rate — but `search_products` only ever exposed `min_price`/
  `max_price`/`category_id`/`in_stock`/`sort`. A user wanting "largest
  monitor under 20,000 Kč" or "compare contrast across candidates" had no
  filter to reach for.
- **First investigation round (2026-09-27, three attempts, all inconclusive)**:
  1. The JSON search API (`v5/search`)'s `params`/`producers` fields accept
     values without a validation error but silently have **no filtering
     effect** on that endpoint.
  2. A first DOM capture of `https://www.alza.cz/sirokouhle-monitory/18876240.htm`
     found brand/producer as plain SEO links but the *visible* ("topped")
     attribute-parameter groups on that narrow subcategory rendered with no
     real hrefs (empty/`#`) — looked like everything beyond brand was
     client-side-only.
  3. Confirmed the facet *definitions* (names, `tId`, value lists) are
     available read-only via the JSON facets API (`GET
     /services/restservice.svc/v3/params/{categoryId}`, row C3) — but round 1
     found no working path from a definition to an actual filtered result.
- **Second round, same session — the actual mechanism found**: re-captured a
  broader category (`/lcd-monitory/18842948.htm`, reached via `/search.htm`'s
  own redirect for a single-category-matching query) and found that
  Checkbox-type facets (the majority — brand, native contrast, panel type,
  resolution, interfaces, aspect ratio, backlight, color depth, energy
  class, …) DO have working URLs: `{categoryId}-par{paramId}-{valueId}.htm`,
  directly parallel to the producer pattern `{categoryId}-v{producerId}.htm`.
  Live-verified: (a) the facet JSON's `v` field is exactly the URL's
  `valueId` (byte-identical, e.g. `239739715` for HDMI) — filter URLs can be
  built purely from the facets API response, no DOM scraping needed; (b) the
  slug segments (category name, filter name) are **purely cosmetic** — any
  text, or none, 200s to the canonical page (`/x/18842948-par....htm`,
  `/wrongslug/...`, and `/18842948-par....htm` all resolved identically);
  (c) multiple filters **compose** by concatenating segments in any tested
  order (`-v{producerId}-par{paramId}-{valueId}...`) and the server applies
  them as a real AND — confirmed via the page's own title changing correctly
  ("Monitory" → "Monitory - HDMI" → "Monitory AOC - HDMI") and via distinct,
  correctly-scoped product codes at each step (the AOC+HDMI page returned
  only `WK...`-family AOC codes).
- **Implemented**: `Catalog.getFacets`/`buildFilteredCategoryUrl` in
  `src/domain/catalog.ts`; new read-only tool `list_category_filters`
  (returns every facet group per category, flagging `filterable: true` only
  for Checkbox-type groups); `search_products` gained `producer_ids` and
  `filters` (`{param_id, value_id}[]`), which switch it to this filtered
  category-browse URL instead of `/search.htm` when `category_id` is also
  given (validated — throws a clear error otherwise). Works for **any**
  category, not just monitors, since the mechanism is generic to Alza's
  catalog UI. Live end-to-end verified: `list_category_filters` on the
  ultrawide-monitor category correctly surfaced a "Nativní kontrast" facet
  up to `1500000:1`; combining that value with an HDMI-interface filter in
  `search_products` returned real, correctly-narrowed results. Unit-tested
  (`buildFilteredCategoryUrl`, `parseFacetsResponse` in
  `test/catalog-sort.test.ts`).
- **Still not filterable**: Slider-type facets (screen diagonal, refresh
  rate, response time, brightness, port *counts*, width/height/depth/weight,
  color-gamut %, energy consumption) — confirmed no discoverable URL/API
  encoding exists for these (the jQuery UI slider fires no XHR on
  interaction this session could capture). `min_screen_inches`/
  `max_screen_inches`'s name-parsing heuristic remains the substitute for
  screen size specifically; other slider attributes have no substitute —
  compare via `get_product`'s scraped `params` field instead.
  `list_category_filters` marks these groups `filterable: false` so the
  distinction is explicit, not silently missing.
- **Re-test target**: if the slider's XHR can be found (e.g. by capturing
  network traffic through a full mouse-drag interaction rather than a
  programmatic click, which this session didn't attempt), a proper
  server-side range filter could replace the size-parsing heuristic too.

### AlzaBox size-eligibility surfaced pre-checkout — closed as infeasible from product data (2026-09-27)

- **The gap:** nothing in `search_products`/`get_product` indicates whether a
  product is AlzaBox-eligible; the only way to find out is to add it to cart
  and read `delivery_options`, which is expensive if you're comparing several
  products.
- **Why it matters:** directly caused wasted round-trips in the 2026-09-26 E2E
  run (three different monitors added to cart just to find eligibility).
- **Resolution (2026-09-27): confirmed infeasible from product-page data.**
  Fetched the raw JSON-LD `Product` schema block Alza embeds on the product
  page (the same source `get_product` scrapes) for the 40" MSI monitor
  (`https://www.alza.cz/40-msi-mag-401qr-d7975093.htm`) directly: it carries
  `name`/`image`/`description`/`sku`/`mpn`/`brand`/`aggregateRating`/`offers`
  only — no `weight`, `width`/`height`/`depth`, or any `additionalProperty`
  entries schema.org would use for package dimensions. There is no
  product-page-level signal to build this from; `delivery_options` against a
  live cart remains the only way to learn AlzaBox eligibility. Not promoted
  to a numbered G-item — closed as a dead end, not deferred.
