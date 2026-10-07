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
  `place_order` is blocked at `sendOrder3` (HTTP 500, G3). Same for the
  after-order payment: the web `CreateAfterPayment` (PA9) executed a real
  payment (MojePlatba → KB SSO) but is documented-only.
- **Why P0:** this is the difference between "MCP can talk about orders" and
  "MCP can place and pay for a real order end-to-end through typed,
  validated, token-guarded tools."
- **Implementation (task 6):**
  - `web_place_order` (high-impact, one-time token from
    `prepare_mutation`): explicit inputs — delivery group/delivery/
    parcel-shop, payment method, user-info block (validated subset of the
    O11 `SaveOrder3` DTO: name, street, city, zip, phone, email,
    countryId), consents. Server-side flow: `SaveOrder2` (with
    `alzaPlusSubscriptionId:0`/`cetelemLeasingId:0` gate-skip) →
    `SaveOrder3` → `SaveAndConfirmOrder2` (auto-retry once on
    `ErrorLevel:113`, the documented AlzaPlus promo gate) → `CheckOrder4` →
    `SendOrder4`; returns the created order id + `GetOrderDetailAction`
    hash link.
  - `web_pay_after_order` (high-impact, one-time token):
    `GetAfterPaymentDialog` (method list, read) + `CreateAfterPayment`
    execution with a validated `paymentId` from the dialog; returns the
    gateway hand-off (e.g. KB SSO URL) — the recorded MojePlatba flow.
  - Whitelist additions to `prepare_mutation`:
    `web_place_order`, `web_after_order_payment` (high-impact set).
  - Unit tests for input validation + the 113-retry logic (mocked
    transport); live verification (task 7) on the real account with a
    minimal-cost order + real after-payment, final states recorded.

### G2. Flip the typed delivery/payment tools from v12 to v13 (closes D1)

- **The gap:** app 2026.17 (latest release) calls
  `getDeliveryPaymentGroups` **v13**; v12 is served in parallel. The typed
  tools (`delivery_options`, `payment_methods`) and the
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
  The mobile `find_pickup_points` / `select_pickup_point` cover the
  mobile equivalents only; the web family is documented but not exposed.
- **Why P1:** read-only, no token needed, directly usable for web-checkout
  delivery selection (pairs with G1: the `parcelShopId`/`deliveryId` that
  `web_place_order` needs come from this tool's responses).
- **Implementation (task 6):** typed `web_pickup_places` (read, no
  token) — inputs: optional type filter, latitude/longitude, paging;
  returns the form (type availability) + list + place detail (deliveryId,
  parcelShopId, isFree, typeText, openingHours). Origin-validated
  (www/m.alza.cz), explicit input validation, unit tests, live re-check.

## P1 — close next (documented, deferred in this goal)

### G4. HATEOAS web cart family (W3/W4/W5) — **implemented 2026-09-09**

`checkout/cart`, `checkout/cart/items`, `POST basket/v1/items` (HATEOAS
`appAction` responses). Implemented as two typed tools: **`web_add_to_cart`**
(commodity_id + count → POST `basket/v1/items`; extracts the basket id from the
response's `order/{basketId}/item/{itemId}` link; the basket is visitor-keyed and
the cookie-less add with a Balancer-Guid header was live-verified 2026-09-09) and
**`web_cart`** (basket_id → the W3 cart state + W4 item list). Unit-tested
(exact body, exact routes, validation); live evidence
`docs/live-evidence/gap-fix-probe-2026-09-09.json` + `gap-fix-probe3-2026-09-09.json`.

### G5. Mobile `sendOrder3` HTTP 500 (O3) — server-side

Re-confirmed 2026-09-06, 2026-09-08 **and** 2026-09-09 (full + empty `Parameters`,
authenticated + guest): `POST /services/restservice.svc/v5/sendOrder3` →
HTTP 500 `InternalServerError` (2026-09-09: fresh basket → sendOrder2 err:0 →
sendOrder3 500, same shape). Nothing the MCP can fix server-side; the
practical closure is G1 (typed web pipeline). Kept `unresolved`; the typed
mobile `place_order` stays live-reached/blocked with the documented
500. **Re-test cadence:** each live-verification run (cheap: one POST).

### G6. Mobile after-order `err:1` for WCF-created orders (PA2/PA3)

Re-confirmed 2026-09-08 **and** 2026-09-09 against still-open order 1056808137
(`getafterorderpayments` → “Faktura se zadaným ID neexistuje”;
`afterOrderPayment` → “Aktualizujte prosím aplikace"). Expected until a
restservice-pipeline order exists (i.e. until G5's 500 is fixed
server-side). The web `CreateAfterPayment` (G1's `web_pay_after_order`)
is the working execution path in the meantime.

## P2 — candidates (status: two implemented 2026-09-09, the rest confirmed documented-only)

| Candidate | Evidence | Note |
|---|---|---|
| Chatbot family (`chatbotapi.alza.cz` `/v1/navigation`, `/v1/chat`, pageType-coded) | W18 (live 2026-09-08; **implemented 2026-09-09**) | Typed tools `chat_navigation` + `chat_send` (session-scoped, visitor-keyed, token-free like `web_add_to_cart`). Live corrections: navigation requires the `country` query field, the chat POST requires `ListCategoryId` (empty array works), pageType codes 1=product detail / 5=Order1 / 6=Order2 / 24=Order4. Record: `docs/live-evidence/p2-implementation-2026-09-09.md` |
| Web telemetry (`logapi.alza.cz /api/log/v2/logs`, `metrics/gs/ccm/collect`, `cdn-cgi/rum`) | W19 (live 2026-09-08) | Out of scope by rule; only relevant as a transport note |
| `next-api/auth/get-session` (Next.js bootstrap) | W1 | Framework plumbing; no user value as a tool |
| 2026.17 server-driven action fields (`afterSelectAction`/`afterDeselectAction` on D1 items, `alzaPlusActionBannerAction`) | re-audit 2026-09-07; **scan 2026-09-09** | **No new API surface needed**: live scan with a real basket — 59 deliveries + 14 payments, 0 non-null actions (`alzaPlusActionBannerAction` null) — nothing to follow up on; documented-only in the coverage doc |
| Bank-app payment channel (PA11: `PayViaBankAppResolver`, preferred-bank-app preference) | re-audit 2026-09-07; **confirmed 2026-09-09** | Client-side UX over the same `paymentId` flow; no new API surface — stays documented-only (PA11) |
| `GetZipCodes` on `EShopService.svc` (WCF twin of D5) | probe 2026-09-08; **implemented 2026-09-09** | `web_zip_codes` whitelist op (`mobile_read`): only the PascalCase `Search` body field binds (6 candidate fields probed); the response `Value` is an HTML snippet of `zip-item` divs; `ErrorLevel:14` when nothing matches. Record: `docs/live-evidence/p2-implementation-2026-09-09.md` |
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
`delivery_options`, `payment_methods`, and `checkout_preview`
automatically. Unit-tested (v13 direct, v13→v12 fallback, no fallback on 500).

**G3 — implemented.** New typed read tool **`web_pickup_places`** (no token):
inputs `order_id?/group_id?/latitude?/longitude?/types[]?/limit?/offset?/place_id?`;
returns `{form, places, detail?}` from the `personalPickup/v1` family
(`webPickupPlaceForm` / `webPickupPlaces` / `webPickupPlaceDetail` in
`MobileApi`, validation in `MobileAccount.webPickupPlaces`). Unit-tested
(input validation + exact routes).

**G1 — implemented.**
- **`web_place_order`** (high-impact, one-time token `web_place_order`):
typed inputs (delivery/group/parcel-shop, payment, user-info block with
email/zip/phone/consent validation); runs `SaveOrder2` (with
`alzaPlusSubscriptionId:0`/`cetelemLeasingId:0` gate-skip) → `SaveOrder3` →
`SaveAndConfirmOrder2` (auto-retry once on `ErrorLevel:113`, the documented
AlzaPlus promo gate) → `CheckOrder4` → `SendOrder4`; throws on any non-zero
`ErrorLevel`; returns `order_id` + `order_detail_link` (GetOrderDetailAction
webLink) + per-step `error_levels`. WCF `d`-envelope unwrapped in
`MobileApi.webWcfStep`.
- **`web_pay_after_order`** (high-impact, one-time token
  `web_after_order_payment`): typed inputs (order_id, payment_id, order_hash?,
  invoice_id?, price?); runs the recorded `CreateAfterPayment` body (the
  2026-09-06 real-payment shape); returns the gateway hand-off result.
- Read companion: `mobile_read` operation **`web_after_payment_dialog`**
  (WCF `GetAfterPaymentDialog`, PA8) — token-free method list for an unpaid order.
- `prepare_mutation` now accepts `web_place_order` + `web_after_order_payment`
  (high-impact set 9→11).
- Unit-tested: full chain happy path incl. the 113-retry, exact WCF bodies
  (SaveOrder2/3 + SendOrder4), non-zero-step failure, single-use token, after-
  order payment body + validation, dialog read route.

All three: `npm test` 60/60, `npm run typecheck`, `npm run build`,
`git diff --check` green (2026-09-08).

**Live verification (task 7, 2026-09-08 — done):** real minimal-cost order
**1057075103** (book FKP0383232, 35 CZK + AlzaBox 2680/1128203, 104 CZK
ex-VAT) created through the exact `web_place_order` WCF chain on the
registered E2E account (user_id 100000001); the `web_after_payment_dialog`
read returned the live after-order method list (213/216/219/143/144/203),
and `web_pay_after_order` (`CreateAfterPayment` 144 MojePlatba) returned
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

- **G4 (above)** — `web_add_to_cart` + `web_cart` typed tools; the
  basket add is visitor-keyed (cookie-less Balancer-Guid add live-verified 2026-09-09, `docs/live-evidence/gap-fix-probe-2026-09-09.json`), so
  the tools work with the standard MCP transport. `webCart` needs only the
  basket_id (the `visitors/{visitorId}` path segment is not validated
  server-side — a placeholder UUID returned the same cart).
- **C12 resolved** (the last `unresolved` catalog row): the C11 navigation
  response carries the full carousel route
  `GET /api/catalog/v1/homePage/categories/{id}?pgri=…&ui=…` (bare route → HTTP
  400; with the server-provided params → 200 `{self, breadcrumbs, name, value,
  disclaimers, shareWebLink}`). Exposed as the `home_categories` read op on
  `mobile_read` (39 read ops at the time; 41 as of 2026-10-07).
- **G5/G6 re-tested 2026-09-09** (above) — both unchanged; they stay
  server-side `unresolved` with a per-run re-test cadence.
- **Found & fixed during the round:** the `web_after_payment_dialog` read op
  (added 2026-09-08) was missing from the `mobile_read` zod enum — the op
  existed in the domain layer but was unreachable through the tool. Now in the
  enum (39 ops at the time; 41 as of 2026-10-07).

Not actionable (unchanged): AT3 (vision API — no static route), the P2 table
(boundary/server-side), and the mobile `place_order` path blocked at G5.
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
- **typed-wrapper-candidate** — a typed tool / `mobile_read` op within the MCP
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
| O3 (G5) | mobile `sendOrder3` HTTP 500 — blocks typed `place_order` step 2 (and O5) | fix-attempt (server-side-suspect) | task-2 | **terminal: server-side-conclusive (2026-09-16, `docs/live-evidence/g5-g6-or11-retest-2026-09-16.md`)** — byte-level app request from APK 2026.17.0 replayed live: the 500 reproduced across UA versions 2026.15/456 + 2026.17/459 + future 2026.18/460 + the MCP control UA; body shapes full/guest/empty/email/`dEmail`; fresh-basket pipeline state (getUserData → basket/add → sendOrder1 → v13 groups → sendOrder2 all 200 err:0, resolved delivery group); registered + guest; and **both hosts `www.alza.cz` and `m.alza.cz`** (the APK host-resolution chain `h31.d()` → `uek.g()` → `u5j` join proves the app's production-mobile API host is **m.alza.cz** — new documented fact, row O3 updated). UA-independent, body-shape-independent, host-independent, auth-independent, pipeline-state-independent → row stays `unresolved`, per-run re-test cadence kept |
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
| P7/P8/D6 | delivery variants/time-frames + personal-delivery scheduling forms | typed-wrapper-candidate | task-6 | **terminal: blocked (dated rationale, 2026-09-24)** — per-basket forms only on `canPickDeliveryTime=true` deliveries; live basket scan (64 delivery variants, disposable 100000002): **0** qualify (`showCourierTimeIntervalPicker` is a UI rule, not a form surface); static read already typed (`delivery_options`); re-test target recorded |
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
creation was reversible only through the dynamic `WatchdogsParams.deleteAction` form.
**Closed 2026-10-06 (issue #17)**: the list (B9a, user navigation → `watchDogs/commodities`)
and the delete (B9b, the per-product `watchdogDialog`'s `deleteAction` →
`DELETE webapi/api/watchdog/v1/{watchdogId}`) were found and live-verified together with
create. The rows are now `live-verified` and wrapped by the typed `watchdog_list` /
`watchdog_set` / `watchdog_delete` tools (one-time tokens, account email never surfaced;
`docs/live-evidence/watchdog-b9-2026-10-06.md`).

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
  (one-time token, `reason` 0–5), live-verified 2026-09-06 against the real order above (`docs/live-evidence/e2e-order-payment-complete.md`)
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

### `list_categories` drill-down bug — found 2026-09-27, fixed since (see CHANGELOG: `list_categories(parent_id)` now returns the real subcategories)

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

### `compare_products` side-by-side comparison — added (2026-10-06)

- **The gap ([#11](https://github.com/lukabudik/alza-mcp-community/issues/11)):** to compare
  candidates, an agent had to call `get_product` N times and build the table
  itself, which filled its context with full product payloads.
- **Fix:** `compare_products({codes: 2–6, summarize?})` (catalog toolset,
  read-only) fetches through `Catalog.getProduct` (product cache), at most two
  pages at a time. It returns one aligned table: Price, Availability and Rating
  first, then every spec name found in any product, matched by exact name. A
  code that fails gets its own `ok: false` column instead of failing the call.
  The alignment is a pure function, `buildComparisonTable`, with unit tests.
- **Sampling ([#18](https://github.com/lukabudik/alza-mcp-community/issues/18)):**
  `summarize: true` calls `server.createMessage` only when the client advertises
  `sampling`. The request uses `includeContext: "none"` and `maxTokens: 400`,
  and the system prompt limits the model to the table. Without the capability,
  the call returns `summary.status: "unavailable"` and no error. A sampling
  failure returns `status: "failed"`.
- **Verification:** **live-verified** 2026-10-06 with two 27" monitors plus one
  bogus code. 37 aligned rows came back and the bogus code got its own error
  column. The sampling round trip was run with a stub sampling client; it was
  not tested with a real sampling-capable host
  (`docs/live-evidence/compare-products-2026-10-06.md`). The same run found that
  JSON-LD spec values were HTML-escaped (`27 &quot;`). `pickAdditionalProperties`
  now decodes entities.

### `select_pickup_point` re-test against an authenticated session — done 2026-10-06 (does not select a pickup point)

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
- **Authenticated re-test (2026-10-06, `unresolved` → resolved as "not a pickup-point
  selector")**: on the authenticated owner session, `delivery_options` returned 2 groups
  (59 + 56 deliveries) and 12 payments. All 127 entries had null
  `beforeSelectAction`/`afterSelectAction`/`afterDeselectAction`, and the AlzaBox entry
  had `associatedItems_cnt: 0`, so no association form exists for an authenticated
  cart either. `select_pickup_point` (`getDeliveryAssociations`, payload mirroring the
  cart's current AlzaBox selection) returned the same delivery → payment association
  list as the anonymous run (payment ids 103/143/144/203/243/211/216, each with the
  delivery price). The cart was recorded before the test and was unchanged afterwards.
  `add_to_cart` was deliberately skipped: the owner's cart was already non-empty, and
  there is no verified line-removal route to restore it exactly. Evidence:
  [`docs/live-evidence/select-pickup-point-auth-retest-2026-10-06.md`](live-evidence/select-pickup-point-auth-retest-2026-10-06.md)
  (+ `.json`). **Outcome applied**: the tool description now says what the route does
  and points at the working chain below. A rename to `delivery_payment_associations`
  (or removal) is proposed to the maintainer.
- **Workaround that works today**: the live-verified
  `add_to_cart` → `delivery_options` → `web_pickup_places` (parsing
  `orderId`/`groupId` from the AlzaBox option's `deliveryOption.href`) →
  `web_place_order` (with `parcel_shop_id` from `web_pickup_places`) chain
  places a real AlzaBox order without needing `select_pickup_point` at all —
  this is the recommended pickup-point path (confirmed by the 2026-10-06 re-test).

### Search-time attribute/facet filtering — closed for Checkbox-type (2026-09-27) and Slider-type (2026-10-06) facets

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
  class, …) have a URL *form*, but only some values are served (**correction,
  live 2026-10-07**: panel type `36359=239959909` (IPS) and resolution
  `18073=239735343` (4K) on monitors category 18842948 are redirected to the
  unfiltered page, like the earlier "Quad HD" redirect (2026-10-03); HDMI
  works because Alza publishes an SEO landing page for it — which values have
  one is only visible from the redirect, so `list_category_filters` cannot mark
  them and `search_products` errors instead of returning unfiltered results)
  with the URL form: `{categoryId}-par{paramId}-{valueId}.htm`,
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
- **Slider-type facets: closed 2026-10-06 (`live-verified`, issue #10).**
  (Superseded: the 2026-09-27 note said slider facets had no URL/API encoding.
  That attempt used a programmatic click, which fires no XHR.) A real Playwright
  mouse drag (`mouse.down` → 15 × `mouse.move` → `mouse.up`) on the diagonal
  slider of `/lcd-monitory/18842948.htm` found the mechanism:
  1. **URL hash**: the page writes
     `#f&cud=0&pg={page}&prod=&par{paramId}={from}--{to}` (e.g.
     `par17816=711.2--2667`). Values are the facet's own step values (`v` in the
     C3 facets API), and there is one `par` entry per slider. The canonical URL and
     `rel=next` don't change. The pager anchors are rewritten to the hash.
  2. **XHR**: the page's JS then POSTs `/Services/EShopService.svc/Filter`
     `{idCategory, producers, parameters:[{typeId, valueFrom, valueTo, orderFrom, orderTo, valueIds}], page, pageTo, sort, searchTerm, …}`.
     The JSON reply is `{d:{Boxes (result-card HTML), Count, Page, PagerBottom, …}}`.
  3. **A fresh page load of the hash URL applies it.** The site's JS issues
     the same `Filter` call. It composes with the existing path segments
     (`-v{producer}-par{param}-{value}` checkbox filters are copied into the
     body), and `pg=N` in the hash selects the page.
  4. Constraints observed live: **both bounds are required**. A missing upper
     bound collapsed to the slider minimum, which gave 0 results. The page snaps values to real steps and
     clamps them to the filtered subset's own range. The search page
     (`/search.htm`) has no sliders and ignores the hash. A `searchTerm` injected
     into the `Filter` body is ignored, so range filtering is a category-browse
     feature, like the checkbox filters. **Units differ per category.** The diagonal
     is millimetres on monitors (`17816`) and laptops (`316`) but inches on TVs
     (`41706`). Laptop RAM is in MB.
  - **Implemented**: `search_products`'s `filters` accepts
    `{param_id, min?, max?}` next to `{param_id, value_id}`.
    `list_category_filters` marks Slider groups `filterable: true,
    filterMode: "range"` and exposes each step's raw `value`. `Catalog`
    snaps the bounds to real steps (`snapRange`) and always sends both. It loads
    `{filteredCategoryUrl}{buildRangeHash(…)}`, waits for the page's own
    `Filter` reply, and extracts cards from `d.Boxes`. The DOM isn't used here
    because it isn't cleared on an empty reply. It also reads the request body
    back, so it can error out if a range wasn't applied and report the
    effective ranges as `appliedRanges`. A range with no step inside it returns
    an empty result (`empty: true`) without fetching a page.
  - **Screen size**: with `category_id`, `min_screen_inches`/
    `max_screen_inches` now run through the category's own diagonal slider. The
    slider is found by its inch-labelled values, so it works with any unit (mm
    or inches). The name-parsing heuristic is now only the fallback when no
    `category_id` is given, the category has no diagonal slider, or the
    category's facets can't be fetched (screen size alone falls back; explicit
    range filters surface the error).
  - Live end-to-end through the MCP server (monitors refresh ≥ 240 Hz, spot-checked
    320 Hz via `get_product`; monitors 42"–45"; TVs 75"–77"; laptops RAM ≥ 64 GB,
    spot-checked; brand + checkbox + two sliders; page 2; price sort sweep; empty
    range; misuse error): see
    [`live-evidence/range-filters-2026-10-06.md`](live-evidence/range-filters-2026-10-06.md).
    Unit tests: `test/range-filters.test.ts`.
  - Still open: keyword text cannot be combined with any facet filter (checkbox
    or range), because Alza's category-browse path has no search-term input.

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

## recommend_alternatives live verification (issue #12, 2026-10-06)

Label: `live-verified` (read-only, unauthenticated, `ALZA_TOKEN_FILE=none`, CF sidecar transport).

- `GET /services/restservice.svc/v1/alternatives/{commodityId}` (C7) returned HTTP 200 without a token: `{has_next, total, data[]}`; each card has `id`, `code`, `name`, `url`, `priceNoCurrency`, `rating` (0-5), `ratingCount`, `avail`, `img`; no brand field. 8 alternatives for an iPhone 17 256GB commodity (all colour variants at the same price).
- Tool run end to end through the MCP server (product page via browser for source price/brand/category, then `MobileApi.alternatives` with the id parsed from the URL): `better-specs` and `same-brand` returned Alza's list ranked by rating; `cheaper` found nothing strictly cheaper in Alza's list, fell back to a same-category `search_products` (category from the breadcrumb is the narrow sub-category "iPhone 17") and honestly returned no matches.
- Known limits: the fallback searches by the breadcrumb category name (not a category id), so a very narrow sub-category can yield no cheaper candidates; `better-specs` ranks by rating, not by spec-table comparison.

### `get_deals` — where sale items come from (research 2026-10-06, issue #13)

Question: where can a read-only tool get discounted products with current price, original price and discount %? All findings below are against alza.cz on 2026-10-06 (anonymous, no account).

| Candidate source | Result | Label |
|---|---|---|
| Search/category listing cards (`.browsingitem`) | **Yes.** The price box (`.ads-pb`) carries the original price in two forms: `.ads-pb__original-price--strike` = the crossed-out original price (e.g. `12 490,-` now, `15 390,-` was; header badge "Zlevněno -18 %"), and a plain `.ads-pb__original-price` = a savings amount (`Ušetříte 100,-`, so original = current + savings). Example: monitor listing 18842948 page 1 → 3 strike cards + 2 "Ušetříte" cards of 24; page-1 sweep of 3 pages found 8 ≥5 % deals. Other header badges ("Super cena", "Cenová bomba") appear with NO original price on many cards and are not treated as discounts. | `live-verified` |
| "Akce"/discount facet via `list_category_filters` | **No.** The full monitor facet list (47 groups, category 18842948) contains no sale/discount/Akce facet; also none exposed in the checkbox facets that `buildFilteredCategoryUrl` can encode. | `live-verified` (negative) |
| Sale category pages | **Marketing hubs, no product grid.** `/vyprodej` → `/mega-slevy/y842.htm`, `/outlet` → `/zbozi-z-druhe-ruky`, `/akce` and `/zlevneno` → 404. The Mega slevy hub links `Alza dny` (`/18906341.htm`), `AlzaPlus+ slevy` (`/18906481.htm`) and has a "Podle slevy" sort control (`#sort_11`, client-side) — none render `.browsingitem` cards on load (0 cards). Top-level categories (e.g. `/18890188.htm` Počítače a notebooky) are hubs with 0 cards too; only leaf categories list products. | `live-verified` (negative for a scrapeable sale list) |
| Free-text `search.htm?exps=zlevněno` | Matches the word in product text (books, cosmetics), not a sale list. `exps=výprodej` redirects to the Mega slevy hub (0 cards). | `live-verified` (negative) |
| Mobile API route for deals | Not present in the APK-confirmed route inventory (`docs/mobile-endpoint-coverage.md`); not investigated further this round. | `unresolved` |
| Coupon-block prices on cards ("Koupit s kódem ALZADNY15 … 3 987,-", "Přidat AlzaPlus+ a koupit hned levněji") | Conditional prices (code / AlzaPlus+ membership). Deliberately NOT treated as the sale price. | `live-verified` (observed, excluded) |

**Resolution:** new read-only `get_deals({category_id?, min_discount_percent?, limit?})` (catalog toolset) scans category listing pages `/{id}.htm` (3 pages ≈ 72 cards for a given leaf `category_id`; page 1 of five popular leaf categories — phones 18843445, notebooks 18842920, monitors 18842948, TVs 18849604, headphones 18843602 — when omitted) and reports only cards with an observed original price, computing `discountPercent = (original − current) / original` itself (the "Zlevněno -N %" badge is never read). Live run (monitors, 2026-10-06): 72 cards scanned, top deal 34.7 % (5 990 from 9 169); the computed 18.8 % / 14.9 % for two products matched their pages' own -18 % / -14 % badges after rounding. Limits, stated in the tool description: bounded sample (not all of Alza's sale inventory), shelf price only (no coupon/AlzaPlus+ price), **CZ-scoped** — the savings wording (`Ušetříte`) and the `N,-` price format are Czech-specific, so the tool errors on `.sk`/`.hu`/… instead of guessing. Dated live evidence: `docs/live-evidence/get-deals-2026-10-06.md`.

## Search suggestions / autocomplete (issue #14, 2026-10-06)

- **Endpoint** `GET https://webapi.alza.cz/api/anonymous/search/whisperer/v1/whisper?country=CZ&visitor={guid}&searchTerm={q}` — `live-verified` 2026-10-06 (browser capture + plain-HTTP replay via the CF sidecar, no auth). Companion `.../emptySearch` for the empty-box dropdown. Details in `docs/mobile-endpoint-coverage.md` C15/C16.
- **Exposure** typed read-only `autocomplete` tool (catalog toolset). APK-side equivalent not separately mapped (`unresolved`); the response carries app-style `appLink` actions (`catalogSearch`, `catalogCategory`, `catalogProductDetail`, `webView`), so the mobile app evidently consumes the same route.
- **Observed limits** ≤5 items per section; `phrases` is often empty for multi-word queries (categories/products still returned); the web UI sends no token for this call.

### Standalone AlzaBox locker discovery — implemented (2026-10-06, [#8](https://github.com/lukabudik/alza-mcp-community/issues/8))

- **The gap:** `find_pickup_points` returned showrooms only. AlzaBoxes were
  reachable only through a live cart (`add_to_cart` → `delivery_options` →
  `web_pickup_places`), because `personalPickup/v1/places` is cart-scoped
  (HTTP 400 without `orderId`/`groupId`, re-confirmed 2026-10-06).
- **Resolution:** the public locker map at `https://www.alza.cz/alzabox` (the
  `alzabox.htm` URL from the issue is a 404) loads its data from a separate
  cart-free family: `GET /api/salesNetwork/v1/places?types%5B0%5D=1&latitude=&longitude=&ordering=0&limit=100`.
  It needs no login or cart, sorts all 4015 AlzaBoxes by distance, and returns
  name, address, GPS, `parcelShopId` and `deliveryId` (2680). The upstream
  caps `limit` at 100. `find_pickup_points` now makes one request per
  uncached geocoded centre and caches the parsed list for 12 h. It applies
  radius and limit locally and merges lockers with the curated showroom list
  by distance. `types: ["alzabox"]` returns lockers only. If the locker
  request fails while showrooms were also requested, the tool returns
  showrooms with a `warnings[]` entry. Coverage rows SN1–SN4 in
  `docs/mobile-endpoint-coverage.md`.
- **Evidence:** `live-verified` 2026-10-06 through the built MCP server
  (anonymous, `ALZA_TOKEN_FILE=none`, CF sidecar): `500 02` + `["alzabox"]` →
  5 lockers 0.2–1.1 km in 741 ms. The repeat query was a cache hit (0 ms, no
  upstream call). `170 00` with default types → the Holešovice showroom
  merged at 0.4 km between lockers. Full record:
  `docs/live-evidence/alzabox-lockers-2026-10-06.md`. Fixture test:
  `test/pickup.test.ts` with `test/fixtures/sales-network-places.json`.
- **Still open:** the list can't say whether a given product fits a locker.
  Oversized items (34"+ monitors, 2026-09-26 above) skip the whole network,
  and only the cart flow knows. The tool description says this. Locker
  opening hours come from the per-place detail (SN3). The tool fetches it only
  for the first 10 lockers returned, caches each for 1 h, and skips a locker's
  hours if its lookup fails. Re-verified live 2026-10-06: `602 00` → 4 lockers,
  3 `Nonstop` and one shopping-arcade locker `09:00 - 21:00`.
  The `icon-2-xl` vs `icon-2` image split might mark XL lockers, but that is
  `unresolved`. Only alza.cz was live-verified; other locales use the same
  route on their own origin.

### Streamable HTTP transport ([#16](https://github.com/lukabudik/alza-mcp-community/issues/16)): local mode shipped, hosting deferred (2026-10-06)

- **Shipped:** `alza-mcp-community --http [--port N]` / `ALZA_TRANSPORT=http` (`src/http.ts`). There is one `McpServer` per MCP session, and only the `catalog` toolset is usable unless `ALZA_HTTP_ENABLE_ACCOUNT=1`. `ALZA_TOKEN_FILE` is loaded only with `ALZA_HTTP_ALLOW_TOKEN_FILE=1`. The local transport, catalog search over HTTP, the toolset lock, per-session toolset/OAuth isolation and per-session sidecars are **live-verified**: see [live-evidence/streamable-http-2026-10-06.md](live-evidence/streamable-http-2026-10-06.md).
- **Why the account toolsets are locked on HTTP:** they sign in to and act on a real Alza account (orders, payments, credential changes). A network endpoint can be reached by more than one client and has no built-in authentication, so these tools are opt-in on HTTP. The operations themselves are unchanged and stay documented: `list_toolsets` shows every locked group and why it is locked.
- **Hosting (Vercel `mcp-handler`, Fly, Railway): unresolved, follow-up.** Alza's Cloudflare Bot Management lets the headless browser and the `curl_cffi` sidecar through from a residential IP. From datacenter IPs they are far more likely to be challenged, as the GitHub-hosted canary runs already show. A hosted instance probably needs a residential proxy or a browser-as-a-service (`ALZA_CDP_URL`), plus sticky sessions and authentication in front of the endpoint. None of this was attempted.
- **Live canary from GitHub-hosted runners: blocked (re-tested 2026-10-07, [run 37578987022](https://github.com/lukabudik/alza-mcp-community/actions/runs/37578987022)).** Every probe got HTTP 403 with `cf-mitigated: challenge` ("Okamžik…" challenge page) for `www.alza.cz` home and search, the `webapi` whisper endpoint and `identity.alza.cz` discovery. That held for plain curl, the `curl_cffi` Chrome-fingerprint sidecar and headless Chromium from the runner's Azure IP, and for curl_cffi, headless and headed Chromium (Xvfb) routed through Cloudflare WARP. The same `curl_cffi` request gets 200 from a residential IP. The fix is the egress, not the client: a self-hosted runner on a residential or office IP (`CANARY_RUNS_ON`), or a residential proxy (`ALZA_PROXY_URL`).

### PC builder (#15): implemented 2026-10-06, with three catalog findings

- **What shipped:** `pc_build_check` and `pc_build_suggest` live in the new `pc_builder` toolset, which is off by default. The compatibility rules are pure functions in `src/domain/pc-build.ts`. They cover socket, RAM generation / DIMM type / slots, RAM ↔ CPU, PSU wattage + headroom, GPU length, cooler height or radiator size, cooler socket, motherboard and PSU form factor, and display output. The spec names come from a Czech per-component map. Live evidence is in `docs/live-evidence/2026-10-06-pc-builder.md`.
- **`blocked`: socket / memory-type / form-factor URL filters in CPU and motherboard categories.** `list_category_filters` reports them as checkbox facets (CPU `Socket` 432, motherboard `Socket` 408 / `Formát základní desky` 411 / `Typ paměti` 414). Alza 30x-redirects every such `-par…` URL to the unfiltered category (live 2026-10-06), and `search_products` errors as designed. The builder narrows candidates on the client instead: first chipset/DDR/wattage name hints on the listing cards, then the detail page's `params`. RAM uses the dedicated DDR5 and DDR4 categories. Only the brand facet (`producer_ids`) is used as a URL filter. Re-test target: a different URL encoding for these facets.
- **`live-verified` (negative, 2026-10-06): `/search.htm?idc={category}` is not category-scoped.** "psu" scoped to the PSU category returned dog food. `pc_build_suggest` browses the category listing page `/{categoryId}.htm` instead, through the internal `SearchOptions.browse`.
- **`get_product`'s 30-row spec cap:** a GPU's `TDP` was row 29 of 30. `Catalog.getProductSpecs` keeps up to 80 rows for the builder from the same page load and cache. The public `get_product` contract (≤ 30 rows) is unchanged.
- **Spec-table render race, fixed:** one live run got a PSU page (`AAnagp2a4`) with no spec rows at the `load` event. A read a minute later had the full table. `getProduct`/`getProductSpecs` now wait up to 4 s for the table and read the page again whenever both spec sources are empty.
- **Remaining limits (`unresolved`):**
  - Alza does not publish power figures for every GPU. When `TDP` is missing, the draw is derived from `Doporučený výkon zdroje` (× 0.4). If neither row exists, a fallback of 250 W is assumed and the rule warns.
  - The CPU boost allowance is TDP × 1.35. That matches AMD's PPT, but Intel's PL2 can be higher.
  - Suggest candidates are the first listing page (Alza's own order) of each category, not the whole catalog.
  - Storage has no compatibility rule. M.2 slot and PCIe generation checks are not modelled.

### Catalog QA fixes (issues #58, #70, #71, #75, #76, #77; live-verified anonymously 2026-10-07)

- **`live-verified` (#76) brand landing redirect on page 1.** `GET /18843445-v1299.htm` (phones + Samsung) answers with a redirect to the curated landing page `/mobily-samsung/18855066.htm` (title "Mobilní telefony Samsung Galaxy", 24 cards, all Samsung), while `/18843445-v1299-p2.htm` keeps the `-v1299` segment. The redirect guard saw the missing segment and rejected page 1. It now accepts the redirect only when the sole dropped segment is the single requested producer, the landed category id differs from the requested one, and the landing page's title/heading names that brand (looked up in `list_category_filters`'s `brands`). A redirect back to the plain category or to a page that does not name the brand still errors.
- **`live-verified` (#75) multi-brand URLs do not exist.** `/{cat}-v1357-v1611.htm`, `-v1357-1611` and `-v1357,1611` all return Alza's 404 error page, which the scraper used to turn into "0 candidates scanned". `producer_ids` now accepts at most one id (schema `maxItems: 1`, domain error as well), and a 404 for a filtered page in an existing category is an error. Call once per brand to compare brands.
- **`live-verified` (#77) unknown category ids.** `/999999999.htm` and `/-1.htm` return HTTP 404 ("Chyba | Alza.cz"); `search.htm?exps=x&idc=999999999` returns HTTP 200 with unrelated keyword results. `search_products` (keyword path), `list_category_filters` and `list_categories` (with `parent_id`) now return `category N not found`. A real leaf category still returns "No categories.".
- **`live-verified` (#70) alza.sk cards.** The card DOM is identical to alza.cz; only the strings differ: price `395,90 €` / `297 €` (`.ads-pb__price-value`), CTA `Do košíka` / `Vybrať variant` (purchasable) and a standalone `Strážiť` button (not purchasable; the `Sledovať dostupnosť alebo cenu` link is on every card). `parsePrice` now reads `N[,dd] €` and `N Kč` besides `N,-`, and the CTA detection knows the Slovak labels, so price, `availability`, `min_price`/`max_price`, price sorts and `in_stock` work on alza.sk. Products whose price cannot be read are now excluded when `min_price`/`max_price` is set (previously they always passed).
- **`live-verified` (#71)** `recommend_alternatives` `same-brand` skipped the diagonal when comparing leading name tokens: `34" iiyama …` no longer matches an `AOC` source.
- **#58** `page` is limited to 1–50 (the highest page Alza renders links for), the sweep loop starts at `page` instead of counting up from 1, and `query` (200), `get_product.code` (64) and `find_pickup_points.postal_code` (16) have length limits so a huge argument fails validation instead of being echoed or stalling the server. A per-call timeout around browser work is not added (`unresolved`).
