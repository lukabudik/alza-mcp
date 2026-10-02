# Task-6b remaining candidates — live probe + dispositions (2026-09-24)

Goal `mu3orcal-hqvsbi`, task-6 (typed wrappers: mutating dynamic actions).
Raw capture: `docs/live-evidence/task6b-remaining-candidates-2026-09-24.json`.
Transport: CF-fingerprint (curl_cffi chrome), `Alza/2026.17.0 (Android)` UA.
Identity: **disposable** account `e2e-user@example.invalid`
(user_id 100000002, created 2026-09-23) — the standing E2E account 100000001 is
never touched by mutations; its token is 401-gated on the www user services
today (see side finding below).

## Live probes (all read-only, no mutations)

| Probe | Route | Result |
|---|---|---|
| login (PKCE) | identity.alza.cz | 200, access token OK |
| getUserData | restservice v2 | 200, baseline user_id 100000002 |
| **OR7 archive (include cancelled)** | `GET /api/users/100000002/v1/orders/archive?hideCancelledOrders=false&productFilterType=0` | **200** `{self (appLink archiveUserOrders), paging {limit 10, size 0}, value: []}` |
| **OR7 archive (hide cancelled)** | `GET …/archive?hideCancelledOrders=true&productFilterType=0` | **200** (same shape, empty) |
| orders root | `GET /api/users/100000002/v1/orders` | 200 — `activeOrders` (form: `productFilterType=0`), `archiveOrders` (form: `hideCancelledOrders` default **false**, label "Skrýt zrušené", + `productFilterType=0`), `orderSearch`, `invoiceLookup` |
| basket add FKP0383232 | restservice v2 | 200 (basket created, id 1659091728) |
| basketInfo | restservice v3 | 200 |
| delivery/payment groups | restservice v13 | 200 — 64 delivery variants + 15 payment options |

## Dispositions per task-6 candidate

### OR7 order archive — **fixed (typed + live-verified, 2026-09-24)**
Static read route confirmed in the orders navigation (form fields
`hideCancelledOrders` default false + fixed `productFilterType=0`). Typed
wrapper `order_archive` implemented (read-only, no token; optional `limit`
1–100; `hide_cancelled_orders` mirrors the app's "Skrýt zrušené" toggle).
Unit-tested (`test/task6-account-mutations.test.ts`, OR7 case). Row →
`live-verified`.

### R6 product rating — **subsumed by the typed R2 flow (rationale, 2026-09-24)**
`ratingAction` belongs to the same WriteReview form family as
`writeReviewAction`; the already-typed `review_submit` carries the rating
value (`rating` 1–5 + optional `text`, one-time token) and executes the
server-provided review form. A separate wrapper would duplicate R2. Row →
`source-confirmed` (subsumed), rationale on the row.

### OR8 order data update / recalculation — **blocked (dated rationale, 2026-09-24)**
`updateOrderDataAction` / `recalculationAction` are server-provided forms that
only appear on orders in a mutable (pending) state. Full action scan of the
standing account's only two orders (2026-09-22,
`task6-orders-sub-2026-09-22.json`): 1056808137 (AlzaBox) and 1058423434
(WCF, cancelled) expose **neither action** — only claim-guide, careBox-link,
and chatbot actions. No order exists on this account in the required state
and creating one is blocked upstream by G5 (sendOrder3 HTTP 500,
server-side-conclusive 2026-09-16). The executor pattern (verbatim action +
one-time token) would carry these forms if/when a qualifying order exists —
re-test target recorded.

### OR9 cancel drop order (AlzaBox) — **blocked (dated rationale, 2026-09-24)**
`cancelDropOrder` is the AlzaBox *subscription* drop-order dialog — it only
appears on an active AlzaBox drop order. The standing account's AlzaBox order
(1056808137, one-off, completed) does not expose it (2026-09-22 action scan,
full list above). No active AlzaBox subscription exists on the account
(`subscriptionsOverview` → 404, 2026-09-22), and none can be created live
without a payment-capable state. Re-test target recorded.

### S5 limit-exceeded repayment — **blocked (dated rationale, 2026-09-24)**
`limitExceededRepaymentAction` appears only in a **failed-installment**
state (installment payment failed → repayment form). The standing account
holds no subscription at all (subscriptions 404, 2026-09-22), hence no
installment, hence no failed installment — the state is unreachable from this
environment. Re-test target recorded (needs an installment + a failed
payment first).

### PA7 quick-order payment — **blocked (dated rationale, 2026-09-24)**
`SubmitQuickOrder` requires (a) the quick-order context on a product page
(`quickOrderSummary` — present in the codebase, per-commodity) and (b) a
**stored payment method** on the account (the quick order pays immediately
with a stored card/`paymentId`). The standing E2E account has no stored
payment method (payment surface PA1 = delivery/payment *option* groups only;
no stored-card read route is mapped), and the disposable account has none
either (2026-09-24 probe). Without a stored payment method the
`SubmitQuickOrder` action is not offered. High-impact (creates **and**
charges) — stays policy-consistent with the other payment hand-offs.
Re-test target recorded (needs a stored payment method on a disposable
account).

### P7/P8/D6 delivery variants / time-frames — **blocked (dated rationale, 2026-09-24)**
The static read side is already typed (`alza_delivery_options` over the
delivery/payment groups). The time-frame / delivery-variant forms
(`DeliveryVariantsActions`, `DeliveryTimeItemsWithForm`,
`DeliveryHoursActions`) are per-basket dynamic forms that only appear when a
delivery has `canPickDeliveryTime=true`. Live scan of a real basket
(2026-09-24): **0 of 64** delivery variants have `canPickDeliveryTime=true`
(all `false`; `showCourierTimeIntervalPicker` is a UI rule, not a form
surface). No time-frame form action is present to execute. Re-test target
recorded (needs a basket whose delivery offers a time frame — e.g. a
courier-to-home delivery for a time-window product).

## Side finding: standing E2E token re-auth window (2026-09-24)

The standing E2E token (original `auth_time` 2026-09-06, refreshed
2026-09-23) now returns **401 "Authorization has been denied"** on the www
`/api/users/{id}/v1/*` user services (OR1 active, OR6 search, OR7 archive,
K1 claims) **and** on `webapi .../userAccount/personalDetails`, while:

- the same routes on the **disposable** account (fresh login, 2026-09-24)
  return **200** — grant type ruled out, token age is the discriminator;
- `restservice getUserData` (200), `api/anonymous/v1/orders/{id}` (OR3, 200)
  and `api/catalog/*` remain reachable;
- 1secmail (the E2E inbox) is currently sinkholed from this egress
  (SPCom s.r.o. warning page on all 1secmail hosts, 2026-09-24), so the
  forgot-password reset cannot be read; re-login needs a reachable CZ/SK SMS
  line or the stored password.

Conclusion: authenticated reads of OR1/K1/OR6/OR7 on the standing account
need a fresh E2E login before the next run. Recorded 2026-09-24; the
disposable account is the working authenticated identity for the
order/account read probes in this batch.

## Orphaned disposable identities (cleanup candidates, updated 2026-09-24)

Seven disposable identities now exist (six from 2026-09-23 + the
100000002 used here). All are throwaway 1secmail accounts; deletion is behind
the SMS step-up gate (see `task6-a14-a18-disposable-2026-09-23.md`).
