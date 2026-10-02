# APK re-audit — 2026-09-09 (latest-release re-check)

Goal task: "Re-audit the latest Alza Android APK" (goal `mttr8nno-hwczyh`, task-1).

## Version evidence (APKCombo listing, fetched 2026-09-09 via Playwright)

- `https://apkcombo.com/alza/cz.alza.eshop/` (HTTP 200): latest version **2026.17.0
  (459)**, update date **Aug 25, 2026** — unchanged from the 2026-09-07 audit.
- Version list on the page: **2026.17.0 / 2026.16.1 / 2026.15.0** — exactly the three
  builds already decompiled. No 2026.18 (or newer) exists as of 2026-09-09.
- Raw capture: `apk-latest-check-2026-09-09.json`.

## Artifact evidence (fresh CDN re-download)

- Signed per-checkin link (`apkcombo.com/d?u=<base64>` → `download.pureapk.com/b/APK/
  cz.alza.eshop_…`) obtained in the browser session; the download needs a top-level
  navigation (in-page `fetch` is CORS-blocked by the cross-origin CDN redirect).
- Fresh download: **22,841,130 B**, filename `Alza_2026.17.0_apkcombo.com.apk`.
- sha256 `b84ee6f1d9d9dae341dbcc4f2050bc3e694baac14cd6c3d957ace3ab7ad08d83` —
  **byte-identical** to the audited `/tmp/alza-2026.17.0.apk` from 2026-09-07
  (same hash on both files).

## Conclusion

- **2026.17.0 is re-confirmed current**; no newer release is obtainable as of 2026-09-09.
- Because the artifact is byte-identical, the existing decompile
  (`/tmp/alza-decompile/jadx-2026-17`, jadx 1.5.0) remains the de-facto source of
  truth for the current release — no re-decompilation, route diff, or field diff is
  required, and every finding in `apk-reaudit-2026-09-07.md` (v13
  `getDeliveryPaymentGroups`, 2026.17 response fields, dynamic-action names,
  bank-app channel PA11, stable 51-route restservice inventory) stands unchanged
  for the current build.
- Registry impact: none — no new rows, no label changes from the APK side.
