# E2E live order + payment record (partial)

> **Superseded:** this is the pre-order read-journey artifact. The complete
> authenticated run — real order 1056808137 placed and a real MojePlatba
> payment executed — is recorded in
> [`e2e-order-payment-complete.md`](e2e-order-payment-complete.md)
> (+ `e2e-order-payment-complete.json`).

- Date: 2026-09-05T19:17:05.019Z
- Account: anonymous
- Transport: Playwright Chromium (browser-backed fetch injected into the real MCP server; plain HTTP is Cloudflare-challenged from this egress — see coverage-doc transport note)
- Product: `CEN178a` (CENTROPEN 9511 tvrdosti HB, H a B, trojhranná - balení 4 ks, price 19)
- Delivery: AlzaBox (option id 2680)
- Payment method: Bankovním převodem - proforma (paymentId 103)
- (partial record — stopped before order submission)

## Payment result (raw `afterOrderPayment` response)

```json
null
```

## Final order state

```json
null
```

## Tool calls (real MCP tool path)

1. `alza_account_status` {}
2. `alza_profile` {}
3. `alza_mobile_read` {"operation":"search","args":{"search_term":"tužka","page":0}}
4. `alza_add_to_cart` {"code":"CEN178a","quantity":1}
5. `alza_cart` {}
6. `alza_mobile_read` {"operation":"basket_info","args":{}}
7. `alza_delivery_options` {}
8. `alza_payment_methods` {"selected_delivery_option_id":2680}

## Notes

- Driven through the real MCP server (buildServer + in-memory MCP client) with a browser-backed fetch; each step is the corresponding MCP tool.
- One-time confirmation tokens (alza_prepare_mutation / checkout preview) used exactly as the tools require.
- Raw step log: `e2e-order-payment.json`.

## Follow-up: full guest run (2026-09-06)

A subsequent full guest run (same driver, updated APK-confirmed `SelectedDelivery`
delivery payload — `deliveryGroups: [{deliveryGroupId, deliveryId, deliveryServicesIds,
parcelShopId, timeFrameId, timeSlotId}]`) exercised `alza_checkout_preview` and
`alza_place_order` (steps `sendOrder2` → `sendOrder3`). Result: `sendOrder2`
registers the delivery + payment selection (err:0), but the guest user-info step
`POST /services/restservice.svc/v5/sendOrder3` returns **HTTP 500** for both tested
`Parameters` shapes (guest `newUserInfo {anonymOrder:true, login}` and empty
`{parameters:{}}`); with an *unregistered* delivery, `sendOrder3` returns 200
(err:1) but `orderfinished` then 500s — a server-side gap in the guest state
machine, so the full order + payment record executes on a real authenticated
account (PKCE login). Raw logs:
`e2e-order-payment-partial-guest-sendorder3-500.json` (latest full guest run) and
`e2e-order-payment-partial-v1-pre-order.json` (first pre-order run).
