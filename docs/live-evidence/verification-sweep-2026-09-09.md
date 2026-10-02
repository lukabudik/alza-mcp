# Live verification sweep — 2026-09-09 (goal `mttr8nno-hwczyh`, task-2)

Transport: Playwright in-page fetch, same-origin on `www.alza.cz` after page
navigation (CF passes post-navigation), mobile headers (`Balancer-Guid`,
`x-correlation-id`), `Authorization: Bearer` for the authenticated rows
(token refreshed 2026-09-09T07:27Z). Raw captures: `verification-sweep-2026-09-09.json`
(+ `-followup`, `-followup2`, `-c8`, `-a7hosts` JSONs).

## Results (13 cheap `source-confirmed` rows + G5/G6 re-tests)

| Row | Probe | Result | Verdict |
|---|---|---|---|
| C2 category tree node | `GET v1/category/1?type=CATEGORY&typeId=0` | **400** `The T field is required / The P field is required`; with `?T=CATEGORY&P=0` → **200** (analytics + category tree) | **live-verified with a param correction**: query fields are `T`/`P` (the documented `type`/`typeId` bind to nothing). MCP `category` op fixed (now sends `T`/`P`). |
| C5 legacy product detail | `GET /api/legacy/catalog/v14/product/5303618?pgrik=&ucik=&country=CZ` | **400** `The Ucik/Pgrik field is required` (even when sent empty); with the `pgrik`/`ucik` values from C6's `self.href` → **200** | **live-verified with a correction**: `pgrik`/`ucik` are REQUIRED and server-provided (take from `router_product` C6), not optional. |
| C6 router product detail | `GET /api/router/legacy/catalog/product/5303618` | **200** bare; `self.href` carries the canonical `?pgrik=p__…&ucik=u__…` | **live-verified** (works bare; the router response is the param source for C5). |
| C8 products by EAN | `POST v1/getProductByEANlist {eanList:["8590878621978"]}` | **200** with product data (resolves to the same commodity 5303618) | **live-verified**. (EAN sourced from the C4 external-product body; C6's body carries no `ean` field — noteworthy for consumers.) |
| A7 premium trial | `GET /api/user/100000001/v1/alzapremium/trial` (Bearer) | **404 SPA HTML** on `www.alza.cz` (bare + `?country=CZ`), **404 SPA HTML** on `m.alza.cz`; `api.alza.cz` does not resolve (DNS). APK dex contains the literal string `/v1/alzapremium/trial` | **stays `source-confirmed`** with a live-404 annotation: the endpoint is removed server-side or served via a gateway neither web host routes. The MCP `premium_trial` op will surface the 404 honestly. |
| A8 login-name validation | `GET v1/validateLoginName?email=probe-…@1secmail.com` | **200** `err:0` (+ basket counters, `vzt`) | **live-verified**. |
| A9 ISIC validation | `POST v2/validateIsic {cardNumber:"0", name:"E2E Probe"}` | **200** `err:1` “Zadejte číslo své ISIC / ITIC karty (např. S123…)” | **live-verified** (app-level validation response; dummy card correctly rejected). |
| B4 basket update | `GET v2/updBasket/{basketId}/0?isDelayedPayment=false` (fresh basket 1656919446) | **200** with the updated basket (`order.priceVat` etc.) | **live-verified**. |
| B5 unlock basket | `POST v1/unlockbasket` → **405** “does not support http method POST”; bare `GET` → **400** `requestModel.Country required`; `GET …?country=CZ` → **200** `err:0` | **live-verified with a correction**: GET + required `country` query field (the row's "POST" annotation was wrong). MCP `unlockBasket` fixed. |
| D2 delivery associations | `POST v4/getDeliveryAssociations {cardId:0, deliveryGroups:[{deliveryGroupId, deliveryId:2680, …}]}` | **200** with `data[]` associations (AlzaBox locations) | **live-verified**. |
| O1 checkout state step 1 | `GET v4/sendOrder1` | **200** (`add_info.max_step:2`) | **live-verified**. |
| O4 approve order | `GET v1/approveOrder4` (Bearer) | **200** WCF-style envelope, graceful app-level error without chain state (“Při potvrzování objednávky došlo k chybě…”) | **live-verified** (route live; functional approval requires the O3 chain — G5-blocked). |
| O6 order 2 info | `GET v8/getOrder2Info` | **400** `requestModel.Country required`; `?country=CZ` → **200** | **live-verified with a correction**: requires a `country` query field. MCP `order2Info` fixed. |
| G5 sendOrder3 | fresh basket → `v7/sendOrder2` **200** (`max_step:3`) → `v5/sendOrder3` | **500** `{"Message":"InternalServerError"}` | **re-confirmed, 4th dated run** (2026-09-06/08/09×2). Stays server-side `unresolved`. |
| G6 after-order | `v2/getafterorderpayments/1056808137/1070772578`; `/api/orders/v4/afterOrderPayment` | both **200** `err:1` (“Faktura se zadaným ID neexistuje” / “Aktualizujte prosím aplikace”, authenticated as user 100000001) | **re-confirmed**. Stays `unresolved` (dependent on G5). |

## Label flips from existing evidence (no new probe needed)

- **A3** (OAuth token exchange): the confidential-client exchange is the core of
  `alza_auth_exchange`, executed live (real login + refresh rotation, 2026-09-06/07/09);
  the status cell already recorded the client-auth probe (`invalid_grant`).
- **A11** (registration): `CreateUser` executed live 2026-09-06 (the real E2E account
  `e2e-user@example.invalid` was created through it).
- **D2**: also carried by the 2026-09-06 E2E ("resolved 1128203 from D2 associations");
  now independently re-probed (above).

## MCP code corrections applied from this sweep (all unit-tested)

1. `MobileApi.category` — query fields `T`/`P` (was `type`/`typeId`, live 400).
2. `MobileApi.unlockBasket` — GET + `?country=CZ` (was bare; POST is a live 405).
3. `MobileApi.order2Info` — `?country=CZ` (live 400 without).
4. `legacyProduct`/`routerProduct` docs — `pgrik`/`ucik` are required server-side
   (live 400 even when empty); take them from the C6 router response. The ops already
   forward them; the `alza_mobile_read` description updated.
