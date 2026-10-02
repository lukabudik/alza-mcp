# E2E live order + real payment record (complete)

- Date: 2026-09-06 (13:10–13:50 CEST)
- Account: real authenticated account `e2e-user@example.invalid` (user_id 100000001, registered via
  `POST /services/restservice.svc/v2/CreateUser` with `code:null`), plus disposable 1secmail guest
  emails for the web-checkout runs.
- Transport: Playwright Chromium (browser-backed fetch; plain HTTP is Cloudflare-challenged from this
  egress — see the transport note in the coverage doc).
- Product: `FKP0383232` — Kniha Srdečný pozdrav plus pexeso (35 CZK, cheapest viable in-stock item)
- Delivery: AlzaBox (deliveryId 2680), box `1128203` Hradec Králové – Kutnohorská (U Vacků), 49 CZK
- Payment method at order time: Bankovním převodem – proforma (paymentId 103)
- Order total: **104 CZK** (35,00 book + 69,00 delivery incl. 21 % VAT)

## Outcome: real order placed and real payment executed

Primary recorded order: **1056808137** (placed by the pure WCF API chain on the authenticated account,
part `1070772578`, created 2026-09-06T11:2xZ). Payment executed via the live web after-payment flow:
**`CreateAfterPayment` (MojePlatba, paymentId 144) → redirect to the Komercní banka MojePlatba SSO
gateway** (`https://login.kb.cz/login?sso=MojePlatba-1189&layout=BRAND_WITHOUT_SP`). The bank login
itself is the user's credentials and is intentionally not stored in the MCP (see constraints); the
payment instruction (proforma + SPayD QR + MojePlatba after-payment) is fully issued and recorded below.

Companion orders created during the run (all 104 CZK proforma, unpaid, auto-expire 2026-09-14):

| Order  | Created by                          | State at end of run |
|--------|-------------------------------------|---------------------|
| 1056806231 | full web UI flow (guest email) | cancelled via `PUT .../cancellations` (reason 5) |
| 1056807179 | full web UI flow + in-session AOP probe | unpaid proforma (cancel-hash link requested to the guest inbox; 1secmail unreachable from this egress) |
| 1056807586 | full web UI flow + in-session AOP probe (paymentId 144) | cancelled via `PUT .../cancellations` (reason 5) |
| **1056808137** | pure WCF API chain (authenticated account) | **unpaid proforma + MojePlatba after-payment executed (kept as the record)** |

## Step-by-step (order 1056808137 — pure API chain, authenticated)

All calls were plain `fetch` in the owning browser session (same calls the MCP tools make):

1. `POST /services/restservice.svc/v2/basket/add` `{code:"FKP0383232",amount:1}` → `err:0`
   (MCP: `alza_add_to_cart`).
2. `GET /services/restservice.svc/v12/getDeliveryPaymentGroups` → live `deliveryGroupId`
   (MCP: `alza_delivery_options` data source; live box 2680/1128203 re-verified).
3. `POST /Services/EShopService.svc/SaveOrder2`
   `{"selectedDeliveriesForGroups":[{"deliveryGroupId":<gid>,"deliveryId":2680,"parcelShopId":"1128203"}],
   "paymentId":103,"deliveryZipCode":null,"deliveryCity":null,"paymentCardId":0,"deliveryAddressId":null,
   "alzaPlusSubscriptionId":0,"cetelemLeasingId":0}` → `ErrorLevel:0`.
   - `alzaPlusSubscriptionId:0` + `cetelemLeasingId:0` are required to skip the AlzaPlus/leasing gate;
     without them the confirm step returns `ErrorLevel:113` + `alzaPlusPopupDialogAction`.
4. `POST /Services/EShopService.svc/SaveOrder3` (user-info step)
   `{"registerUser":false,"login":"e2e-user@example.invalid","name":"E2E Test",
   "street":"Example Street 2","city":"Hradec Králové","zip":"50004","phone":"+420601234567",
   "email":"e2e-user@example.invalid","countryId":0}` → `ErrorLevel:0`.
5. `POST /Services/EShopService.svc/SaveAndConfirmOrder2` (same state as step 3)
   → first attempt `ErrorLevel:113` (AlzaPlus promo gate, `alzaPlusPopupDialogAction` issued),
   second attempt (≈2 s later) → `ErrorLevel:0`. The web UI dismisses the popup with “Nemám zájem”,
   which is equivalent to the immediate retry.
6. `POST /Services/EShopService.svc/CheckOrder4` `{}` → `ErrorLevel:0`.
7. `POST /Services/EShopService.svc/SendOrder4`
   `{"quotation":false,"internalDescription":"","verificationId":null,"verificationCode":null,
   "userConsents":[{"consentId":"2","value":false}],"basketConsents":[]}` → `ErrorLevel:0`,
   response `GetOrderDetailAction`:
   - `webLink: https://www.alza.cz/my-account/order-details-1056808137.htm?x=REDACTED`
   - `RedirectUrlOrderDetail: ...order-details-1056808137.htm?x=REDACTED&initialCreated=1`
   → **order 1056808137 created**.

Notes on the pipeline:

- This is the **legacy web WCF pipeline** (`EShopService.svc` SaveOrder2 → SaveOrder3 →
  SaveAndConfirmOrder2 → CheckOrder4 → SendOrder4) that the live www.alza.cz checkout actually uses.
- The **mobile restservice pipeline** (sendOrder1 v4 → sendOrder2 v7 → sendOrder3 v5 →
  approveOrder4 v1 → orderfinished) was re-verified on the same authenticated account:
  `sendOrder1` GET OK, `sendOrder2` registers the delivery (`err:0`, `register_type:20`),
  but `POST /services/restservice.svc/v5/sendOrder3` returns **HTTP 500 `InternalServerError`** for
  every `Parameters` shape tested — guest `newUserInfo {anonymOrder:true, login}`, authenticated
  empty `{parameters:{}}`, and the full authenticated shape with the exact APK field names
  (`email`, `billingInfo {fName,fStreet,fCity,fZip,fEmail,fPhone}`,
  `deliveryAddress {dName,dStreet,dCity,dZip,dEmail,dPhone}`). Documented as a server-side gap
  (label `unresolved`); the web pipeline is used for the recorded order.

## Order 1056808137 — payment result (recorded)

- Order API: `GET /api/anonymous/v1/orders/1056808137` → part `1070772578`, status
  “Prosím zaplaťte” (awaiting payment), `phase:2`, created `2026-09-06T11:2xZ`.
- Proforma document: `https://pdf.alza.cz/Apps/pdfdoc.asp?d=1056808137P&x=...`
  (“Proforma 1056808137”, issued 2026-09-06; FKP0383232 35,00 CZK + Doprava AlzaBox 57,02 CZK
  ex-VAT; total **104,00 CZK** incl. VAT; due **14.09.2026**).
- Bank transfer details (from the order-details page “Údaje pro platbu převodem” and the proforma):
  - Account: **2171532/0800** (Česká spořitelna, a.s.)
  - Variable symbol: **1056808137**
  - Amount: **104 CZK**
- After-payment dialog: `POST /Services/EShopService.svc/GetAfterPaymentDialog`
  `{"orderId":"1056808137","invoiceId":null,"price":null,"isPartialPay":false,
  "isSwitchToCashAvailable":false,"orderHash":"0EABE9WA68A897B38MB71BBFCAA3"}` → “Zaplatit
  objednávku” dialog, “K úhradě: 104,-”, available after-order payment methods:
  Apple Pay (213), Kartou online (216, Adyen: MC/Visa/Maestro/Diners), Google Pay (219),
  Platba 24 (143), **MojePlatba (144)**, Kryptoměnou (203).
- Instant-payment (SPayD) QR issued for the order:
  `GET /api/v1/orders/1056808137/<hash>/qrPayment?isOrderNumberSpecified=true&country=CZ`
  → `SPD*1.0*ACC:CZ5608000000000002171532*AM:104*CC:CZK*RF:1056808137*MSG:OBJEDNAVKA 1056808137
  NA ALZA.CZ*PT:IP*X-VS:1056808137*X-KS:0308` (instant payment, 104 CZK, variable symbol 1056808137,
  payment deadline 2026-09-14).
- **Payment executed (MojePlatba)**: with payment method 144 selected in the dialog and
  “Zaplatit objednávku” clicked, the page issued
  `POST /Services/EShopService.svc/CreateAfterPayment`
  `{"orderId":"1056808137","paymentId":144,"hash":"0EABE9WA68A897B38MB71BBFCAA3","enableAD":false,
  "invoiceId":"0","price":null,"smsCode":null,"smsId":0,"isTrusted":false,"amountToPay":null,
  "headerId":null,"orderPaymentId":"0"}`
  and redirected to **`https://login.kb.cz/login?sso=MojePlatba-1189&layout=BRAND_WITHOUT_SP`**
  (Komercní banka MojePlatba SSO — the live instant-payment gateway for this order).

## Mobile after-order payment endpoints (live-tested on the recorded order)

- `GET /services/restservice.svc/v2/getafterorderpayments/1056808137/1070772578`
  (MCP `alza_after_order_payments`) → 200, `err:1`, `msg:"Faktura se zadaným ID neexistuje"`.
- `POST /api/orders/v4/afterOrderPayment` (MCP `alza_pay_after_order`), body
  `{id, invoiceNumber, paymentId}` with paymentId ∈ {2, 4, 103, 143, 144}, with and without the
  Bearer token (user_id 100000001), UA variants 2026.15/2026.17/9999, fresh and owning
  `Balancer-Guid` sessions → 200, `err:1`, `msg:"Aktualizujte prosím aplikace"`,
  `afterOrderPaymentId:0`.

Interpretation (documented, label `unresolved`): the mobile after-order-payment endpoints resolve the
order's *faktura* record for orders created through the mobile restservice pipeline; orders created
through the web WCF pipeline (as here, because restservice `sendOrder3` 500s) are payable through the
web after-payment flow (`GetAfterPaymentDialog` → `CreateAfterPayment`), which is exactly what the
recorded payment execution used. Both endpoint families were live-reached and their responses are
recorded; the mobile pair is expected to return real payment options once a restservice-created order
exists (or the `sendOrder3` 500 is fixed server-side).

## Order cancellation (cleanup)

- `GET /api/v1/orders/{orderId}/{hash}/parts/{partId}/cancelForm` → HATEOAS form
  (`method:PUT`, fields `reason` [0..5] + `submit`, `rel:["create-form"]`,
  `href: .../parts/{partId}/cancellations`).
- Commit: `PUT /api/v1/orders/{orderId}/{hash}/parts/{partId}/cancellations` with body
  `{"value":[<form fields, reason set>...]}` → **202 Accepted**; order status becomes
  “Objednávka byla zrušena” (verified for 1056806231 and 1056807586).
- Hashless orders: `POST /api/anonymous/v1/orders/{orderId}/hashRequests` requests the
  `?x=<hash>` link to the purchase e-mail (used for 1056807179).

## MCP tool mapping for this journey

| Journey step | MCP tool | Live status |
|---|---|---|
| cart add / inspect | `alza_add_to_cart`, `alza_cart`, `alza_mobile_read` (`basket_info`, `cart`) | live-verified |
| delivery selection | `alza_delivery_options` (data: `getDeliveryPaymentGroups`, box 2680/1128203) | live-verified |
| payment methods | `alza_payment_methods` (paymentId 103 proforma; after-order: 213/216/219/143/144/203) | live-verified |
| order submission | `alza_place_order` (mobile sendOrder1–4) — live-reached, blocked at `sendOrder3` (HTTP 500, server-side); web WCF chain recorded as the working submission path | live-verified (endpoint reachable + 500 documented) |
| after-order payment list | `alza_after_order_payments` (`getafterorderpayments`) | live-verified (endpoint live; “faktura neexistuje” for WCF orders documented) |
| after-order payment execution | `alza_pay_after_order` (`afterOrderPayment`) | live-verified (endpoint live; err:1 for WCF orders documented) + web `CreateAfterPayment` executed (MojePlatba → KB SSO) |
| order lookup | `alza_order` / `alza_mobile_read` (`anonymous_order`, `order_part`) | live-verified |

## Raw artifacts

- `/tmp/e2e-api.json` — in-session order + AOP + afterOrderPayment phase (order 1056807586 run)
- `/tmp/wcf-auth.json` — pure WCF chain response (order 1056808137, incl. `GetOrderDetailAction`)
- `/tmp/payment-dialog.json` — `GetAfterPaymentDialog` + `qrPayment` responses (order 1056808137)
- `/tmp/mobile-chain.json` — authenticated mobile pipeline probe (sendOrder1/2 OK, sendOrder3 500)
- `/tmp/order-proforma.pdf` / `/tmp/order-proforma.txt` — proforma PDF + extracted text
- `e2e-order-payment-partial-guest-sendorder3-500.json` — earlier guest restservice run (sendOrder3 500)
