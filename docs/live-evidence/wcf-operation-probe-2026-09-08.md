# WCF `EShopService.svc` operation probe (2026-09-08)

**Goal:** close the legacy WCF order+payment family (new-goal task 3) with a
live, evidence-based operation inventory instead of a guessed one.

**Method:** Playwright (Chromium, desktop UA) on `www.alza.cz`; the home page
loads first (passes the Cloudflare challenge), then 92 candidate operation names
are POSTed in-page to `/Services/EShopService.svc/{op}` with an empty JSON body
(`Content-Type: application/json` — the same transport the live checkout uses;
a plain-HTTP session gets CF-challenged, which is why the probe is in-browser).
Raw results: `wcf-operation-probe-2026-09-08.json` (status + 220-char body prefix
per operation).

## Result: the family is closed — 10 operations exist

| Status | Operations |
|---|---|
| **200 (app-level, `{"d":…}` WCF envelope)** | `LeaveOrder1`, `SaveOrder2`, `SaveOrder3`, `SaveAndConfirmOrder2`, `CheckOrder4`, `SendOrder4`, `VerifyUser`, `GetAfterPaymentDialog`, `CreateAfterPayment`, `GetZipCodes` |
| **404 (route does not exist)** | the other 82 probed names — incl. `LeaveOrder2/3/4`, `SaveOrder1/4`, `SaveAndConfirmOrder1/3`, `CheckOrder1–3/5`, `SendOrder1–3/5`, `GetAfterOrderPayments`, `AfterOrderPayment`, all `GetOrder*`/`Cancel*`/`Coupon*`/`Pickup*`/`Invoice*`/`Payment*` variants, `GetOrderAddInfo/2Info/3Info` (those are restservice routes — O6/O7), … |

Consequences recorded in `docs/mobile-endpoint-coverage.md`:
- **O11** expanded to the full 10-operation inventory (family closed; no hidden
  WCF order/payment routes remain).
- **W16 resolved** (`unresolved` → `live-verified` at route level): since
  `LeaveOrder2`/`LeaveOrder3` are 404, the Order2→3 transition *is*
  `SaveOrder2` (delivery+payment registration) with the `SaveAndConfirmOrder2`
  retry for the `ErrorLevel:113` AlzaPlus promo gate — the exact chain the
  2026-09-06 E2E ran successfully.
- **`GetZipCodes`** exists on the WCF service too (twin of the D5 restservice
  route) — documented.
- Response envelope fields confirmed across all 10: `DevErrorMessage`,
  `Message`, `ErrorNeoPurchaseFailed`, `ErrorLevel`, `RedirectUrlOrderDetail`,
  `PaymentAction`, `CanShowFastCheckoutButton`, `LeasingPartnerUrl` (+ per-op
  fields, e.g. `LeaveOrder1.UnavailableBasketProductsAction`,
  `CheckOrder4.bankIdAuthApiAction`, `SendOrder4.GiveSharedLimitConsentAction` —
  added to the dynamic-action registry).

Note: the probe used empty bodies — app-level validation errors
(`ErrorLevel:1`, “Neplatná objednávka” / “Košík je prázdný”) confirm the routes
are live without side effects (no basket registered → no state advanced).
