# Mobile-pipeline gap re-verification (2026-09-08)

New-goal task 4: re-test the three documented mobile-pipeline gaps with fresh,
dated evidence. All three **re-confirmed unchanged**.

## Gap 1 — `sendOrder3` HTTP 500 (row O3, label `unresolved`)

Authenticated (PKCE, user_id 100000001), fresh cart, in-browser transport
(`gap-recheck-mobile-2026-09-08.json`, steps A1–A5b):

| Step | Call | Result |
|---|---|---|
| A1 | `POST /services/restservice.svc/v2/basket/add {code:"FKP0383232",amount:1}` | 200, `err:0` |
| A2 | `GET /services/restservice.svc/v13/getDeliveryPaymentGroups` | **200 — v13 still served (row D1: the typed tools still call v12; gap persists)** |
| A3 | `GET /services/restservice.svc/v12/getDeliveryPaymentGroups` | 200 (v12 still served in parallel) |
| A4 | `POST /services/restservice.svc/v7/sendOrder2` (AlzaBox 2680/1128203, payment 103) | 200, `register_type:20`, `max_step:3` |
| A5 | `POST /services/restservice.svc/v5/sendOrder3` (full authenticated `Parameters`) | **HTTP 500 `{"Message":"InternalServerError"}` — re-confirmed** |
| A5b | `POST /services/restservice.svc/v5/sendOrder3` (empty `Parameters`) | **HTTP 500 — re-confirmed** |

## Gap 2 — mobile after-order endpoints `err:1` for WCF-created orders (rows PA2/PA3)

Against the still-unpaid E2E order **1056808137 / part 1070772578** (proforma
due 2026-09-14, still open), steps B1–B3:

| Step | Call | Result |
|---|---|---|
| B1 | `GET /services/restservice.svc/v2/getafterorderpayments/1056808137/1070772578` | 200, `err:1`, `msg:"Faktura se zadaným ID neexistuje"`, `payments:null` — identical to 2026-09-06 |
| B2 | `POST /api/orders/v4/afterOrderPayment {id:1056808137, invoiceNumber:"1070772578", paymentId:144}` (Bearer) | 200, `err:1`, `msg:"Aktualizujte prosím aplikace"`, `afterOrderPaymentId:0` — identical |
| B3 | same with `paymentId:103`, no Bearer | 200, `err:1`, identical |

Interpretation unchanged: the mobile pair resolves the order's *faktura* record
for restservice-pipeline orders; WCF-created orders stay payable through the web
`GetAfterPaymentDialog` → `CreateAfterPayment` flow (PA8/PA9) or `qrPayment` (PA10).

## Gap 3 — AlzaPlus `ErrorLevel:113` promo gate (row O11)

Fresh guest cart, WCF chain (`gate113-recheck-2026-09-08.json`, steps C1–C6):

| Step | Call | Result |
|---|---|---|
| C1–C4 | `basket/add` → `getDeliveryPaymentGroups` (live gid) → `SaveOrder2` → `SaveOrder3` | all `ErrorLevel:0` |
| C5 | `SaveAndConfirmOrder2` — **first attempt** | **`ErrorLevel:113` + `alzaPlusPopupDialogAction` ISSUED** (gate still active 2026-09-08) |
| C6 | `SaveAndConfirmOrder2` — retry (~2 s later) | `ErrorLevel:0` — identical to the 2026-09-06 behavior (web UI dismisses the popup with “Nemám zájem” ≙ immediate retry) |

Stopped before `CheckOrder4`/`SendOrder4` — no order created by this re-check.

## Docs updated

- O3 / PA2 / PA3 / O11 rows: “re-confirmed 2026-09-08” notes.
- D1 row: v13 re-verified served again (2026-09-08); the typed-tools v12→v13 flip stays a named gap.
