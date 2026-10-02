# APK re-audit — 2026-09-07

Goal: latest-release re-audit (task-1 of the gap-analysis goal).

## Version evidence

- Play Store (`play.google.com/store/apps/details?id=cz.alza.eshop`, fetched 2026-09-07):
  latest version **2026.17.0**, released **Sep 3, 2026** (unix 1788455624). Release notes:
  “This release includes bug fixes and minor enhancements based upon your suggestions and
  comments. We have added the option to set a preferred application for bank payments.”
- Version history listed on the Play Store page: 2026.15.0, 2026.14.0, 2026.12.0, 2026.11.0,
  2026.9.0, 2026.7.0, 2026.4.0, 2025.8.0 (plus 2026.17.0 current; 2026.16.1 exists as a
  release on the CDN).
- APKs obtained via APKCombo → `download.pureapk.com` CDN (signed per-checkin URLs,
  session cookies required): `alza-2026.15.0.apk` (23,023,563 B), `alza-2026.16.1.apk`
  (23,118,004 B), `alza-2026.17.0.apk` (22,841,130 B — valid Android package, gradle
  app-metadata present).

## Method

- jadx 1.5.0 decompilation of all three APKs (`/tmp/alza-decompile/jadx-2026-{15,16,17}`),
  plus dex string-table extraction (route constants and operation names are string-table
  entries; the Ktor-based client assembles URLs at runtime).
- Diffs: restservice route inventories (51 routes each), `/api/...` string inventories,
  lowerCamel endpoint-like token sets, `cz.alza` package trees, and field-level model
  comparison (`Delivery`, `Payment`, `CardPayment`, `AfterOrderRequestBody`).

## Findings (full detail in `docs/mobile-endpoint-coverage.md` → “APK 2026.16.1 / 2026.17 re-audit”)

1. `getDeliveryPaymentGroups` **v12 → v13** (between 2026.16.1 and 2026.17.0). Live check
   2026-09-07: **both v12 and v13 return 200 JSON** (empty-cart `err:1 "Invalid order"`
   expected); v13 is the app's current version. MCP tools still call v12 — named gap.
2. New 2026.17 response-model fields: `afterSelectAction`/`afterDeselectAction`
   (Delivery/Payment items), `Payment.isConditionalFreeDelivery`,
   `CardPayment.hideStoredPaymentCards`, `canShowPaymentDetail`,
   `deliveryGroupIdsBeforeAction` — response-side only.
3. New 2026.17 dynamic action names: `alzaPlusActionBannerAction`,
   `afterSelectAction`/`afterDeselectAction` family (`paymentAfterSelectAction`/
   `paymentAfterDeselectAction`) — documented in the dynamic-action registry (`blocked`).
4. Bank-app payment: `PayViaBankAppResolver` (deep-link to an installed bank app for
   after-order payment; screens since 2026.15). 2026.17 adds the **preferred-bank-app
   preference** (`SetDefaultBankApp` analytics event, `isBankAppOnboardingEnabled` flag)
   and `qrCodeResultReceiver`. API-level flow unchanged (PA2/PA3/PA9) → documented as PA11.
5. 2026.16.1: `AccountUserInfo.detailedUserInfo` (response-side; removed again in 2026.17)
   + `onProduct*Click` analytics. No route changes.
6. Restservice route inventory otherwise **stable** across 15/16.1/17 (51 routes).
7. `AfterOrderRequestBody` unchanged across all three versions — `alza_pay_after_order`
   DTO stays valid.
