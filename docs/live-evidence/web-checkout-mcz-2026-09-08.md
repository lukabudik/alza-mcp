# Web checkout (m.alza.cz) — live capture record

**Date:** 2026-09-07/08 (goal task 2, new-goal scope: web checkout APIs)
**Method:** Playwright (Chromium, mobile UA `Chrome/138` Android, viewport 412×915),
guest visitor sessions. Every XHR/fetch request + response (bodies truncated to
2–8 KB) was logged per UI step; 8 fresh sessions (each new context = new visitor +
guest basket). Raw logs: `/tmp/mcz-checkout1..8.json` (kept in /tmp); de-duplicated,
route-normalized digest with key response bodies:
`docs/live-evidence/web-checkout-mcz-digest.json`.
**Test product:** `zviratka-d5303619` (Pexeso, commodity 5303619, ~119 CZK).

## Findings

1. **m.alza.cz is a Next.js/React app** (Tailwind, Material-UI dialogs) with GWT-legacy
   Order pages. New **HATEOAS REST family** with `appAction` responses
   (`self.href` + `appLink` + `enabled`): `checkout/cart`, `checkout/cart/items`,
   `basket/v1/announcements`, `Cookies/v1/groups`, `personalPickup/v1/*`,
   `visitors/{id}/statusSummary`, `navigation` (+ `parcelLockers` action).
2. **`m.alza.cz` hosts its own WCF services** — `POST m.alza.cz/Services/EShopService.svc/LeaveOrder1?showVoucherDialog=`
   (Order1→Order2 transition, 200 in 5 captures) and
   `GET m.alza.cz/services/restservice.svc/v2/getOrderAddInfo`
   (`{addInfo:{max_step}, basket_cnt, user_id, vzt, serverTime}`). Same service family
   as the mobile app (A10/O7/O11) — the web host serves it too.
3. **Pickup family** (new): `pickupPlaceForm` (per-type availability: AlzaBox ~3970
   places, branches, 24/7, showrooms), `points` (map), `places` (paginated list),
   `places/{id}` (detail: `deliveryId`, `parcelShopId`, `isFree`, `typeText`
   "AlzaBranch"/"AlzaBox", `standardPrice`, `openingHours[]`). `GET places/601`
   (Alza Hradec Králové branch) captured live.
4. **Page flow:** Order1 (cart) → `LeaveOrder1` → Order2 (delivery+payment; pickup
   dialogs) → Order3 (user info + payment). **`Order4.htm` = live 404 on m.alza.cz**
   (the mobile-web UI is 3-step). `Order3.htm` redirects to `Order2.htm` until a
   delivery method is registered in the WCF state (`max_step` gate, observed live).
   The Order2→3 WCF trigger (`SaveOrder2`-equivalent + `LeaveOrder2`) is the same
   O11 family but its exact React-flow trigger call was **not captured** (the place
   selection dialog needs a confirmed selection; `Pokračovat` no-ops until then) —
   labeled `unresolved` (row W16).
5. **Product page family (webapi.alza.cz):** `carousels/v1/commodities/{id}/
   recommendedAccessorySlots|purchasedTogether|bestsellers`,
   `catalog/v2/commodities/{id}/reviewStats|reviews`, `commodity/v2/{id}/buyActions`,
   `POST commodities/v1/adCommodityView` (202), `productAvailability`,
   `POST m.alza.cz/api/Article/Get`, `GET m.alza.cz/Services/RestService.svc/v1/
   product/{id}/ribbon` (case-sensitive casing on the web host).
6. **Out-of-scope families observed (documented candidates for the gap report):**
   chatbot (`chatbotapi.alza.cz /api/visitors/{id}/v1/navigation|chat`,
   `pageType` 5/6/24), web telemetry (`logapi.alza.cz /api/log/v2/logs` React
   appVersion 4.227.0, `m.alza.cz/metrics/gs/ccm/collect`, `cdn-cgi/rum`).

All W1–W19 rows: `docs/mobile-endpoint-coverage.md` → section 13.
