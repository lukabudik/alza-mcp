# AT3 vision API — APK re-scan + live probe (2026-09-24)

Goal `mu3orcal-hqvsbi`, task-7. Closes coverage row AT3, which was
`unresolved — no static route in APK source (vision API is server-configured)`.

## APK re-scan (2026.17.0, versionCode 459 — `/tmp/alza-2026.17.0.apk`)

**Correction to the prior assumption: the vision API DOES have a static route.**

1. **Packages present** (jadx, `/tmp/alza-decompile/jadx-2026-17/`):
   - `cz.alza.base.api.vision` — `api/model/data/VisionScanResult`
     (`{source: CAMERA|GALLERY, value: String}` — the scanned code + its origin).
   - `cz.alza.base.lib.vision` — `model/request/ProductByEanRequest`
     (`{eanList: List<String>}`), `model/response/ProductDetailEanResponse`
     (`extends BaseResponse {data: ProductDetailEanData}`),
     `model/data/{VisionParams, Barcode, BarcodeResult, ScanOption, BarcodeOverlay}`,
     `viewmodel/*`, `navigation/command/VisionCommand`.
   - `cz.alza.base.android.vision` — `ui/activity/VisionActivity`,
     `ui/service/VisionQuickTileService` (camera quick-tile).
   - `BarcodeResult` sub-types: `Order`, `Login`, `OrderStatus`, `NotFound` —
     the scanner resolves camera captures into order lookups / logins, not just
     product barcodes.
2. **Static route in the dex string pool** (`classes.dex`, adjacent to the other
   restservice routes `getCommodityLists`/`getZipCodes`/`hierarchicalFilter`):
   ```
   /services/restservice.svc/v1/getProductByEANlist
   ```
   i.e. the camera-scan flow is: decode barcode → `POST
   /services/restservice.svc/v1/getProductByEANlist` with `ProductByEanRequest
   {eanList}` → `ProductDetailEanResponse`. No server-configured action needed
   for the product-lookup half (the order/login sub-types are the same decoded
   value routed app-locally).
3. **Scope note**: this is a barcode/EAN product lookup (the "vision" feature),
   not a free-form receipt/photo OCR API — the prior row's "receipt/photo
   analysis" label over-stated it. No image-upload route for vision exists in
   the string pool (the `VisionParams` model carries scan options, not image
   payloads).

## Live probe (2026-09-24, CF-fingerprint transport, `Alza/2026.17.0 (Android)` UA)

| # | Request | Result |
|---|---------|--------|
| 1 | `POST https://www.alza.cz/services/restservice.svc/v1/getProductByEANlist` `{"eanList": ["8594021283371"]}` | **200** `{"data": null, "err": 1, "msg": "No products found.", "vzt": …, "countryPhonePrefix": "420", …}` — standard `BaseResponse` envelope |
| 2 | same with `{"eanList": ["0693965174645"]}` | **200** `err:1 "No products found."` (identical envelope) |

Route is up, the `eanList` DTO is bound (no 400 on shape), the envelope matches
the restservice family. Both test EANs are not in Alza's catalog — a positive
`err:0` match requires an EAN known to be stocked (none was obtainable from the
API surface: the v14 product JSON, `webapi /api/commodity/v1/{id}`, the v5
search results, and the SEO JSON-LD of the Rapture X-RAY page 6900089 expose
no EAN field; the rendered product page carries no EAN text either). The
negative-case envelope is the documented re-test target: re-run with a stocked
EAN whenever one is available.

## MCP closure

- Typed read-only wrapper `product_by_ean` (`POST .../v1/getProductByEANlist`,
  `{eanList}`; 1–20 barcodes, 6–14 digits; no token) — implemented in this
  batch, unit-tested (`test/task6-account-mutations.test.ts`, AT3 case).
- Coverage row AT3: `unresolved` → `live-verified` (static route present +
  live envelope verified; positive match pending a stocked EAN — re-test target
  recorded, 2026-09-24).
