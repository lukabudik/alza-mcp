# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- README **Contributors** section, thanking [@samuelseidel](https://github.com/samuelseidel).

### Changed
- CHANGELOG: the 0.3.0 changes now sit under a dated 0.3.0 heading. They had been left under Unreleased, next to a stale 0.3.0 entry from the fork.

## [0.3.0] — 2026-10-05

The first release with outside contributions: account, cart, checkout, order and payment tools, toolsets, and typed output schemas, contributed by [@samuelseidel](https://github.com/samuelseidel) ([#1](https://github.com/lukabudik/alza-mcp/pull/1), [#5](https://github.com/lukabudik/alza-mcp/pull/5)). Also fixes `npx -y alza-mcp` installs, which were broken in 0.1.2 and 0.2.0.

### Integrated

- Luka’s v0.2.0 catalog fixes: brands from the facets API, rejected filters detected after redirects, filter-preserving pagination, and real subcategory discovery.
- Luka’s pending #4 packaging fix: ship the Chromium postinstall hook and install the packed tarball in CI.
- Preserve upstream’s npm trusted-publishing workflow and the full account/checkout toolsets with output schemas and confirmation tokens.

### Changed

- **Repo cleanup (2026-10-02).** Removed 39 untracked-by-design scratch scripts from `scripts/` (dotfile probes/sweeps, two embedded the OAuth client secret); redacted order access hashes (`?x=…`), real account ids, throwaway email addresses, visitor GUIDs in `docs/live-evidence/`, and two street addresses from evidence and tests. Git history is unchanged and still contains the unredacted values.
- **Pre-publication documentation pass (2026-10-02).** README: corrected statements that were no longer true (it said the client "does not bypass bot protection", that the project is "read-only by design", and that credential flows are blocked); documented the Cloudflare-circumvention transport, that it is absent from the published npm package, the embedded OAuth client credential, and that order/account tools act on real accounts; rewrote the Disclaimer (legal posture, real-money actions, no warranty); updated the architecture diagram, roadmap, FAQ and the credential-handling answer (`change_password`/`phone_change`/`email_change` do take credentials as arguments); replaced a personal absolute path. `CONTRIBUTING.md`: tool registration now requires returning the `RegisteredTool` handle and assigning the tool to a toolset. Added `SECURITY.md` and `docs/upstream-comparison.md`.

### Fixed

- **`get_product` no longer silently returns no specs for products using the `additionalProperty` JSON-LD template** (found live-verifying a router search: Mikrotik CRS304-4XG-IN returned `params: undefined` despite Alza's page clearly listing its port speeds). `getProduct` now merges the JSON-LD `Product.additionalProperty` (schema.org `PropertyValue[]`) with the existing DOM `.paramTbl` scrape instead of relying on the DOM table alone — live-verified (21 rows recovered, including the exact 10 Gbit port count) with no regression on products that already worked via the DOM table. See `docs/gap-analysis.md`.

### Added

- **Real per-category attribute filtering, for any category** — `list_category_filters(category_id)` (new read-only tool) reads Alza's live facet definitions (brand, contrast, panel type, resolution, interfaces, …) and `search_products` gained `producer_ids`/`filters` to actually apply them. Live-verified mechanism: Checkbox-type facets map to a real, composable Alza URL (`{categoryId}-v{producerId}-par{paramId}-{valueId}...`, slug segments are cosmetic) — confirmed via matching facet-API value ids to URL value ids, multi-filter AND composition (page title + product codes both changed correctly), and an end-to-end run that found and applied the highest native-contrast tier for a monitor category. Slider-type facets (screen size, refresh rate, weight, …) still have no discoverable filter API — `list_category_filters` marks those `filterable: false` explicitly rather than silently omitting them. See `docs/gap-analysis.md`.
- **`search_products` gains `min_screen_inches`/`max_screen_inches`** — a name-based substitute for Alza's real screen-diagonal filter, which is a client-side-only slider with no discoverable API/URL encoding (investigated live; see `docs/gap-analysis.md`). Parses the leading size token from display product names (e.g. `40" MSI MAG401QR` → 40) and filters the already-fetched candidate pool, same as the existing price/in-stock filters. `search_products`'s description now also points at the actual path for comparing other attributes (contrast, panel type, etc.) across candidates: `get_product`'s scraped `params` spec table, compared client-side — there is no server-side filter for those.
- **Progressive tool disclosure (toolsets)**: the server's 53 tools are now grouped into 8 toolsets (`src/tools/toolsets.ts`); only `catalog` and `auth` (10 tools) are enabled by default, keeping `tools/list` small. `list_toolsets` shows every group and `set_toolset({id, enabled})` turns one on/off (or `all`), using the SDK's native `enable()`/`disable()` + `tools/list_changed` notification — no functionality removed, everything is reachable once enabled. See `docs/mcp-best-practices-audit.md` F-11.
- **`cancel_order` typed tool (OR11)**, live-verified 2026-09-26 against a real order created through `web_place_order` and cancelled end to end: `GET /api/v1/orders/{id}/{hash}/parts/{partId}/cancelForm` → `PUT .../cancellations` with a one-time `prepare_mutation` token (action `cancel_order`), `reason` 0–5. Unit-tested (token gating, single-use, reason validation, request shape).

### Fixed

- **Documentation corrections from a real live E2E run (2026-09-26, real order 1060090910: 40" monitor → cancelled)**, all in tool descriptions/docstrings, no behavior change to working tools:
  - `find_pickup_points`/`Pickup` module: corrected "AlzaBox discovery not yet implemented" to explain *why* — the live `personalPickup/v1/places`/`pickupPlaceForm` endpoints 400 without an `orderId`/`groupId` from an active cart; it's checkout-cart-scoped, not a standalone geo lookup. Pointed the description at the actual working sequence (`add_to_cart` → `delivery_options` → `web_pickup_places`).
  - `web_pickup_places`: documented that `order_id`/`group_id` are typed optional but the live API 400s without both, and that distance-sort silently falls back to a small fixed list without them; added the worked example.
  - **Corrected a wrong cart-pairing claim**: `web_place_order` (legacy WCF pipeline) submits the cart populated by `add_to_cart` (mobile `restservice.svc/v2/basket/add`), NOT the HATEOAS cart from `web_add_to_cart`/`web_cart` as the prior descriptions implied. Fixed in all four tool descriptions.
  - `add_to_cart`/`delivery_options`: noted live-verified anonymous-session behavior — both succeed without an OAuth token (fall back to an anonymous visitor-keyed WCF cart), making the full `add_to_cart` → `delivery_options` → `web_place_order` chain usable end to end without login.
  - Documented, from live testing across three monitor sizes, that Alza excludes large items (observed: 34"+ monitors) from the entire AlzaBox locker network — not just distance-limited, structurally excluded — routing them to a small nationwide set of oversized-item pickup points instead.

- **Task-6 account credential/identity mutations closed** (goal `mu3orcal-hqvsbi`, 2026-09-23) — five formerly `blocked` rows (A14–A16, A18 + the A16 email sibling) are now typed tools with one-time tokens, explicit validation, and unit tests:
  - `change_password` (A14): `POST /api/users/{id}/v2/account/password` `{oldPassword, password1, password2}`; new ≥ 8 chars, confirm must match, new ≠ old.
  - `two_factor_set` (A15): `PATCH /api/users/{id}/v1/account` JSON-Patch `{op:replace, path:/2faEnabled, value:bool}`; boolean-validated, reversible.
  - `phone_change` (A16): same PATCH route, `path:/phone`; international-form number.
  - `email_change` (A16 sibling): same PATCH route, `path:/email`.
  - `delete_account` (A18): `DELETE /api/users/{id}/v1/account {acknowledgeAndDelete:true}`; `destructiveHint: true`; **disposable accounts only — the standing E2E account 100000001 must never be deleted**.
  - Live verification (`docs/live-evidence/task6-a14-a18-disposable-2026-09-23.md`): all five exact routes + DTOs + Alza's SMS step-up chain (`second-factor/requests` → 200 `TwoFactorAuthSms`, `confirmations` → 400 `InvalidUnlockCode`) reproduced live on a **disposable** account (100000002). The final 4-digit code entry is environment-blocked (free shared SMS gateways don't receive Alza's codes from this egress) — a dated re-test target.
- **Task-6b remaining candidates closed** (goal `mu3orcal-hqvsbi`, 2026-09-24) — `docs/live-evidence/task6b-remaining-candidates-2026-09-24.md`:
  - `order_archive` (row OR7): the `archiveOrders` navigation section is a **static read** — `GET /api/users/{id}/v1/orders/archive?hideCancelledOrders={bool}&productFilterType=0[&limit=]` (default includes cancelled per the APK form; `hide_cancelled_orders` mirrors the app's "Skrýt zrušené" toggle; `limit` 1–100). Read-only, no token. Live: 200 both toggle variants on the disposable account (empty `value[]` + paging).
  - R6 (product rating): **subsumed** — the typed `review_submit` already carries the rating value (`rating` 1–5 + `text`, one-time token); row → `source-confirmed` (rationale on the row).
  - OR8 (update/recalc), OR9 (cancel drop order), S5 (limit repayment), PA7 (quick-order), P7/P8/D6 (delivery time-frames): **blocked with dated rationale (2026-09-24)** — each state is unreachable from the standing environment (no pending-order actions on the standing orders; no AlzaBox drop subscription; no subscription → no failed installment; no stored payment method; 0 of 64 live basket deliveries expose a time-frame form). Every one is a recorded re-test target.
- **AT3 vision API closed** (goal `mu3orcal-hqvsbi`, 2026-09-24) — `docs/live-evidence/at3-vision-rescan-2026-09-24.md`:
  - APK 2026.17.0 re-scan corrects the prior "no static route" assumption: `POST /services/restservice.svc/v1/getProductByEANlist` is in the dex string pool (request `ProductByEanRequest {eanList}`, response `ProductDetailEanResponse {data}`; packages `cz.alza.base.{api,lib,android}.vision`).
  - New typed read `product_by_ean` (1–20 barcodes, 6–14 digits, no token, no account required).
  - Live: route up + DTO bound — unknown EANs → 200 `err:1 "No products found."` (standard `BaseResponse` envelope); a positive `err:0` match needs a stocked EAN (none exposed by the catalog APIs/pages probed) — recorded re-test target. Row `unresolved` → `live-verified`.
- **Task-5 read-side dynamic actions closed** (goal `mu3orcal-hqvsbi`, 2026-09-22) — four formerly `blocked` rows are now typed tools with input validation, unit tests, and live-verified evidence (`docs/live-evidence/task5-a17-or6-or10-k2-2026-09-22.md`):
  - `order_search` (row OR6): `POST /api/users/{userId}/v1/orders/search/results?country=CZ` with `searchTerm` (1–64) + `user_id`; form-urlencoded per the APK `userOrdersSearch` form (both encodings accepted live; `searchTerm` required — 400 without); returns `orders[]` incl. invoice `documents[]` + `commodities[]`. Live: 200 with 1 order.
  - `gdpr_info` (row A17): reads the `PersonalGdprDetails` section (`gdprInfoAction` + `deleteAccountAction`) and the export dialog (`emailInfo` = the account's own login email). Live: both 200.
  - `gdpr_export` (row A17, low-risk mutation): one-time `prepare_mutation` token; `POST .../v1/userAccount/gdprInformation` — Alza queues the XML export to the account's own login email. Live: **202 Accepted**.
  - `order_document` (row OR10): follows a `Document.self.href` copied verbatim from a prior MCP response; HTTPS-only, origin-validated to the Alza host family (incl. `pdf.alza.cz`), max 8 MiB, text-or-base64 body, non-allowlisted redirects blocked. Live: invoice PDF 200, `%PDF-1.7`, 350,287 bytes.
  - `claim_detail` (row K2): executes the per-claim `detailAction` via the AppAction executor (same pattern as `complaint_claims`), read-only. `source-confirmed` with a dated rationale — the E2E account has zero claims (active + archive lists 200, empty), so detail execution is unverified until a claim exists.
- **Chrome-fingerprint transport** (`src/infra/impersonate-transport.ts` + `scripts/cf-transport.py`, `curl_cffi` sidecar): bypasses the Cloudflare bot wall without a browser; `MobileApi` optionally takes an `httpFetch` and falls back cf → plain → in-page browser fetch.

### Changed

- Coverage rows A17/OR6/OR10 flipped `blocked` → `live-verified`, K2 `blocked` → `source-confirmed` (dated rationale); PA4 carries the dated Box2Box-reachability rationale (2026-09-22). `docs/mobile-endpoint-coverage.md` + `docs/gap-analysis.md` blocker matrix synced; main-table `blocked` rows 21 → 17.
- Tool count 41 → 45 (annotation + outputSchema contract tests updated accordingly).
- **Task-6/6b/AT3 sync (2026-09-23/24)**: coverage rows A14/A15/A16/A18 flipped `blocked` → `live-verified` (routes + DTOs + SMS step-up chain live-verified on a disposable account; final code entry environment-blocked — re-test target), OR7 → `live-verified` (typed `order_archive`), R6 → `source-confirmed` (subsumed by `review_submit`), AT3 `unresolved` → `live-verified` (typed `product_by_ean`); OR8/OR9/S5/PA7/P7/P8/D6 stay `blocked` with explicit dated rationale + re-test targets (2026-09-24). Gap-analysis blocker matrix + dynamic-action registry synced; main-table `blocked` rows 17 → 11 (all with dated rationale), `unresolved` rows 2 → 1 (O3 only).
- Tool count 45 → 50 → **52**: task-5 added 4 (`order_search`/`gdpr_info`/`order_document`/`claim_detail`), the A14–A18 wrappers added 5 (`change_password`/`two_factor_set`/`phone_change`/`email_change`/`delete_account`), and this session adds 2 (`order_archive`, `product_by_ean`); annotation + outputSchema contract tests updated accordingly.
- Operational note (2026-09-24): the standing E2E token is 401-gated on the www `/api/users/{id}/v1/*` user services (token-age re-auth window; the 1secmail inbox is sinkholed from this egress) — a fresh E2E login is required for authenticated OR1/K1/OR6/OR7 reads on the standing account; the disposable account 100000002 is the working authenticated identity for this batch.

### Fork development history (2026-09-13)

Everything below was developed on [@samuelseidel](https://github.com/samuelseidel)'s fork before it was merged, grouped by theme.

### Added

- **Full practical Alza API surface** (36 account tools over 5 catalog tools — 41 total): anonymous + authenticated account stack — auth PKCE sign-in, mobile reads via a 38-operation `alza_mobile_read` whitelist, typed high-impact mutations (cart, delivery/pickup, checkout preview + place order, profile/addresses, payments, orders, review submit, complaints, subscriptions, attachment upload), and the legacy web WCF checkout/order/payment family. Two-step mutation design: mutating tools return a one-time confirmation token bound to exactly one action; the actual call goes out only on a follow-up `mutate_list`/typed mutation with that token.
- **Per-tool outputSchema** (41 tools): loose envelope schema (`err`/`msg`/`data`) on the raw tools; typed schemas on `auth_discovery` (OIDC document), `auth_start`, `prepare_mutation`, `account_status`, `checkout_preview`, `web_pickup_places`, and all 5 catalog tools. SDK validates each call's `structuredContent` against the published schema.
- **Agent-driven eval harness** (`npm run eval`): 6 non-mutating scenarios over the in-memory transport (registration surface, catalog read, auth discovery, account status, account read, input-validation error quality); per-check observed values land in `docs/live-evidence/eval-<date>.json`.
- **pi gateway integration**: pi exposes the 41 tools under the `alza_` prefix; verified in-session and headlessly (3 scripted `pi -p` runs, `docs/live-evidence/headless-pi-2026-09-13.json`).
- MCP best-practices audit trail: `docs/mcp-best-practices-audit.md` (F-01…F-10 fixes, 2026-09-13 re-audit regression table, N-1…N-4).

### Changed

- **Naming convention unified to bare tool names** (36 tools dropped the redundant `alza_` server-name prefix).
- **Descriptions rewritten agent-facing** (what/when/when-not/prerequisites/side effects per tool), stale v0.1/v0.2 caveats removed.
- **Annotations completed and harmonized**: readOnly/destructive/modifier hints on all 41 tools; destructive=true on exactly the 8 high-impact calls; 18 mutating tools correctly marked `readOnly: false`.
- **Concise text channel + bounded raw envelopes**: raw tools return the upstream JSON in `structuredContent` with a short human-readable text block; cart/checkout/order responses are summarized.
- **Catalog search**: price/rating sorting gathers candidates from up to 3 REAL result pages, following Alza's rendered pagination anchors (search.htm?pg=N is ignored server-side — pg=2/3 repeat page 1; the rendered `-pN.htm` links do serve distinct products); dedup by code, client-side sort. `in_stock` derives from the card purchase CTA (nbsp-normalized; watch-button cards excluded). `candidatesScanned` is always present (how many cards were scanned before filtering/sorting, echoed in the response and the concise text), and the card extraction retries a bounded 3 times after a cold-browser launch so a slow render doesn't report a false "No products found". Explicit `page` follows rendered pagination; a page beyond the rendered set returns no results instead of repeating page 1.

### Fixed

- Browser memory leak and idle shutdown (carried over from 0.1.1 fixes, kept in 0.3.0).
- `find_pickup_points` no longer documents a non-existent AlzaBox surface; stale v0.2 pickup comments removed.
- Deterministic tool registration order (catalog → account → advanced) and wire-level annotation-contract tests.

## [0.2.1] — 2026-10-03 (not published; shipped in 0.3.0)

### Fixed
- **`npx -y alza-mcp` failed to install.** `scripts/postinstall.cjs` was missing from the published package, so the postinstall hook crashed. CI now installs the packed tarball to catch this.

## [0.2.0] — 2026-10-03

Catalog improvements ported from [#1](https://github.com/lukabudik/alza-mcp/pull/1) by [@samuelseidel](https://github.com/samuelseidel). Thank you!

### Added
- **`list_category_filters`** — a category's brands and attribute facets with real ids and product counts.
- **Brand and attribute filtering** in `search_products` (`producer_ids`, `filters`, requires `category_id`). Uses Alza's own filtered category pages. Alza only honours URL filters for some facets; when it drops one, the tool now returns an error instead of unfiltered results.
- `min_screen_inches` / `max_screen_inches` — name-based screen-size filter for displays.
- `candidatesScanned` in search results.

### Fixed
- **Sorting.** Alza's search page ignores server-side sort, so `price-asc` / `price-desc` / `rating` now sweep up to 3 pages and sort client-side.
- **Pagination.** `search.htm?pg=N` is ignored by Alza; pages now follow the rendered page links (or build `-pN` URLs for filtered category pages, whose own links drop the filter).
- **`in_stock`** now actually filters, based on the card's purchase button.
- **`get_product` specs.** Merges the JSON-LD `additionalProperty` list, so products whose page has no DOM spec table now return params.
- **`list_categories(parent_id)`** returned the top-level list for every parent. It now returns the real subcategories.
- Invalid tool arguments return a readable message.

## [0.1.2] — 2026-05-11

### Added
- 🎉 **Published to npm** as [`alza-mcp`](https://www.npmjs.com/package/alza-mcp). The one-line install (`claude mcp add alza --scope user -- npx -y alza-mcp`) now actually works.

### Changed
- Honest tool descriptions for known v0.1 partial-failures. `get_product_reviews` now states it returns aggregate ratings only (individual review bodies are v0.2). `get_product` notes that the `params` spec table is often empty in v0.1.

### Removed
- Dead `fetchAllAlzaboxes()` HTTP code in `pickup.ts` — `api.alzabox.cz` no longer resolves and we never used it. AlzaBox discovery returns in v0.2 via DOM scrape of the public locker map.



## [0.1.1] — 2026-05-09

### Fixed
- **Memory leak.** The browser used to hold up to 4 pooled pages forever, and one of them ballooned to ~1.9 GB after a few searches because pooled pages accumulate DOM/JS heap across navigations. Pages are now closed after each tool call.
- **Browser never shut down.** Once launched, the headless Chromium ran until the MCP process itself exited — meaning a long-running Claude Code session held a few hundred MB of headless-shell forever. Browser now auto-closes after 3 minutes of tool inactivity (`ALZA_IDLE_TTL_MS` to override). Next tool call relaunches transparently.

Memory profile after the fix: ~215 MB peak during active use, **0 MB** within 3 minutes of the last tool call. Was 4+ GB and growing.

### Added
- `ALZA_IDLE_TTL_MS` env var to tune the idle-shutdown window.



## [0.1.0] — 2026-05-09

### Added
- Initial release. Read-only MCP server for Alza.cz over stdio.
- Tools: `search_products`, `get_product`, `get_product_reviews`, `find_pickup_points`, `list_categories`.
- Resource: `alza://product/{code}`.
- Prompt: `find-product`.
- Cloudflare-aware HTTP client with mobile-app fingerprint, handshake, cookie jar, retry, and proxy hook.
- AlzaBox API integration for parcel-locker discovery.
- Static dataset of major Alza brick-and-mortar branches.
- Locales: `.cz`, `.sk`, `.hu`, `.at`, `.de`, `.co.uk`.
- `validate-api` script for upstream drift detection.
