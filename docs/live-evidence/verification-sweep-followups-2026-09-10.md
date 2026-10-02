# Verification sweep — follow-ups 3–9 (2026-09-09 → 2026-09-10)

Re-audit of every remaining `source-confirmed` row in `docs/mobile-endpoint-coverage.md`.
Probes ran through the established Playwright in-page fetch harness (same-origin on
www.alza.cz for the restservice family; same-origin on a webapi.alza.cz page for the
`webapi` families), Chrome 138 UA, `Balancer-Guid` + `x-correlation-id` mobile headers,
`credentials: include`, Bearer token from `/home/dev/.alza-mcp/tokens.json`.
Raw captures: `docs/live-evidence/verification-sweep-followup3…9-2026-09-{09,10}.json`.
Harness scripts: `scripts/.sweep-followup3.mjs` … `.sweep-followup9.mjs`.

## Token-expiry lesson (A4)

Sweeps 5–7 produced a wall of 401s that looked like route failures. Root cause: the
access token had been obtained 2026-09-09 07:27Z with `expires_in 5400s` and had expired.
Re-running `node scripts/alza-auth-refresh.mjs` (2026-09-10T06:30Z) went discovery-403
(bot wall) → APK-default endpoint fallback → grant succeeded, refresh token rotated,
`tokens.json` re-stamped (`expires_in 5400s`). Every previously-401ing authed probe then
returned 200/err:0 on the first try. Consequence recorded honestly:

- **A4 → `live-verified`** (2026-09-10, script run evidence above; direct node fetch of the
  grant endpoint still 403s behind the bot wall — the script's browser-context discovery is
  what works).
- Diagnostic rule of thumb for this repo: **401 = expired/absent token; 403 = route exists
  but policy forbids; 404 = route not served by that host** (www 404s the `webapi`
  mainNavigation/review families entirely).

## Rows flipped to `live-verified`

| Row | Probe (date) | Result | Capture |
| --- | --- | --- | --- |
| A10 o3Info | 2026-09-09: bare GET | 200 JSON envelope | followup3 |
| C9 hierarchicalFilter | 2026-09-10: POST `{}` authed | 200 app-level err:1 bound to user_id 100000001 | followup9 |
| C13 visitorNavigation | 2026-09-09: webapi same-origin `?country=CZ` | 200; bare → 400 "The Country field is required."; www → 404 | followup6/7 |
| C14 userNavigation | 2026-09-10: fresh-token webapi GET | 200 with real authenticated nav (logout/selectAccount/userCommodities/orderCommoditySearch…); www → 404 route-not-found | followup9 |
| A12 setCountry | 2026-09-10: POST same-value `countryId:0` (CZ per D3 chain) | 200 err:0 user_id 100000001 (idempotent no-op) | followup9 |
| A13 setIsic | 2026-09-10: POST `{isic:""}` | 200 err:0 user_id 100000001 (empty accepted; real card unproven) | followup8 |
| B6 addcoupon | 2026-09-10: GET `/v1/addcoupon/PROBE-XXXX` authed | 200 err:1 bogus-code envelope bound to user_id 100000001 | followup9 |
| B7 delcoupon | 2026-09-09/10: GET `/v1/delcoupon/{x}` | bogus code → 400 ModelState; id `1` → 200 err:1 "Kupón není v košíku" | followup3/9 |
| B8 addGift | 2026-09-10: POST `{rangeIdsGiftCodes:[]}` | 200 err:0 (empty no-op) | followup9 |
| B11 shopping lists | 2026-09-09/10: create `{name:"probe-…"}` → delete `{id}` | 200 (id in `data[0].id`, e.g. 166250295) → delete err:0; probe lists cleaned up | followup3/5/9 |
| O8 costEstimate | 2026-09-10: POST `{}` authed | 200 `CostEstimateResult` (`isTaxed:false, feeAmount:0, rate:21, originalAmount "0 Kč", finalAmount "0 Kč"`) | followup9 |
| O9 addOrderService | 2026-09-09: GET `/v1/addOrderService/probeService/1/0` | 400 ModelState: first segment binds `orderItemId` (Int32) | followup3 |
| O10 feedback | 2026-09-10: POST `{text:"",info:""}` | 200 err:1 "Text komentáře musí být zadán." (validation, nothing stored) | followup9 |
| OR5 quickOrder summary | 2026-09-10: fresh-token GET `?pgrik=p__26752&ucik=u__401f1` | 200 real summary (`totalPrice 119.00`, `deliveryId 2680`, `alzaBoxId 1168379`) | followup8/9 |
| R1 reviews family | 2026-09-09/10: webapi `reviews?country=CZ`, `reviewStats`, substituted `userReviewActions` | 200 (list + paging + templated form); flag-shaped `/api/users/{flag}/…/review` → SPA-404 on www, **403 Forbidden** on webapi (policy) | followup7/9 |

## Corrections propagated into the implementation

- **B7**: `delcoupon` first segment is `couponId` (Int32), not the coupon code → MCP
  `deleteCoupon(couponId)` + whitelist field `coupon_remove: ["couponId"]` + integer check.
- **O9**: `addOrderService` first segment is `orderItemId` (Int32) → MCP
  `addOrderService(orderItemId, enabled, selected)` + whitelist `add_order_service:
  ["orderItemId","enabled","selected"]`.
- **R1**: MCP `user_review` repointed from the (policy-403) flag-shaped review route to the
  live-verified reviews list `https://webapi.alza.cz/api/catalog/commodities/{id}/reviews?country=CZ&limit=5`.
- **C13/C14**: MCP `visitorNavigation`/`userNavigation` repointed to the webapi host with the
  required `country=CZ` query field (www 404s at the router).
- **O8**: row DTO corrected from APK source — `CostEstimate` (2026.17,
  `cz/alza/base/lib/paymentcard/model/request/CostEstimate.java`) carries only
  order/payment/card-referencing fields (`afterOrderPaymentId, cardId, cardType,
  deliveryPaymentPrice, encryptedCard, invoiceId, isAfterOrder, masterOrderId, orderId,
  paymentId, paymentReference, priceToPay, priceWithText`) — **no product ids**; the earlier
  "product ids + delivery/payment context" description was wrong.
- Unit tests updated for all of the above (`test/account.test.ts`); suite 66/66 green.

## Rows kept `source-confirmed` with dated evidence

- **B9 watchdog** — not probed: creation is persistent and its only reversal is the
  server-provided dynamic `WatchdogsParams.deleteAction` form → excluded per the
  no-dynamic-actions policy.
- **A7 / S2** — route not served (404) as recorded 2026-09-09.
- Documented-only exclusions unchanged: R2/R4/R5 (create public content, no reversal),
  P2–P6 / K1/K4/K5 / S1 / AT1/AT2 (server-provided dynamic actions), S3/S4 (subscription
  writes), O5 (G5-gated), PA11 (bank-app channel), D1 afterSelect/afterDeselect
  (0 non-null in a 59-delivery × 14-payment scan).

## Side effects / cleanup

No persistent state left behind: all probe shopping lists deleted (166247730, 166249024,
166249281, 166250295); no coupon applied; no gift attached; no feedback stored; country
left at its same value (CZ); ISIC left empty (was empty).
