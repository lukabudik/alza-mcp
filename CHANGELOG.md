# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `ensureChromiumInstalled`: redirect Playwright download output to stderr instead of inheriting stdout (`stdio: ['ignore', 2, 2]`), preventing non-JSON download progress from corrupting the MCP stdio JSON-RPC stream (#67).

### Added
- Alza storefront links returned by the catalog tools (`search_products`, `get_product`, `compare_products`, `recommend_alternatives`, `get_deals`, `autocomplete`, `list_categories`, `pc_build_check`, `pc_build_suggest`, `watchdog_list` and the `alza://product/{code}` resource) now carry `utm_source=alza-mcp-community&utm_medium=mcp`, at Alza's request, so Alza can attribute visits from the MCP. The parameters are added at output time on copies, so cached and internally navigated URLs stay untagged. Only `www.alza.*` storefront hosts are tagged; OAuth, API, PDF, image and payment URLs and the account/checkout passthrough tools are not. Live-checked 2026-10-07: tagged search, detail and autocomplete links open the right product page (HTTP 200).
- `report_issue`, an always-available tool that drafts a GitHub issue for this repository when a tool fails unexpectedly, returns clearly wrong data, or breaks because Alza changed something. It returns a redacted Markdown draft (version, Node, platform, storefront, transport, this session's last 5 tool errors), a `gh issue list` duplicate search, a ready-to-run `gh issue create` command, and a prefilled new-issue link. It files nothing itself; the agent asks the user first. The server instructions mention it, and unexpected tool errors (not invalid arguments or unknown products) end with a hint pointing to it. Credentials, OAuth redirect parameters, JWTs, e-mails, phone numbers, account ids in API paths, long opaque tokens and home-directory paths are redacted.
- `ALZA_PROXY_URL` now works. It was mentioned in the Cloudflare error message and the bug template but nothing read it. An HTTP(S) or SOCKS5 proxy URL, with optional `user:pass@`, routes the managed Chromium (Playwright `proxy`) and the `curl_cffi` sidecar (`Session(proxy=…)`) through it. Verified 2026-10-07 against a local authenticating proxy: a live `search_products` and a sidecar request both went through it with credentials. The live canary passes an optional `ALZA_PROXY_URL` repository secret, because GitHub-hosted runner IPs are challenged whatever the client (see `docs/gap-analysis.md`).

## [0.4.0] — 2026-10-07

New catalog tools (compare, alternatives, deals, autocomplete, review bodies, AlzaBox lockers, range filters), a PC builder, price watchdogs, Streamable HTTP transport, one-click installs and a Claude Desktop bundle, and the OAuth fix for npm installs.

### Added
- `compare_products` (catalog toolset, read-only): 2–6 product codes side by side as one aligned spec table (price, availability, rating, then every spec row in any product). Pages load two at a time through the product cache; a bad code is reported in its own column instead of failing the call ([#11](https://github.com/lukabudik/alza-mcp/issues/11)). Optional `summarize: true` asks the client's LLM for a short verdict via MCP sampling, grounded only in the table, capped at 400 tokens; clients without sampling get the table and `summary.status: "unavailable"` ([#18](https://github.com/lukabudik/alza-mcp/issues/18)).
- **`recommend_alternatives` tool (#12)** — read-only, `catalog` toolset. `{code, mode?: cheaper|better-specs|same-brand, limit?}` uses Alza's own alternatives list (`MobileApi.alternatives`, keyed by the numeric `d########` commodity id from the product URL, via the Cloudflare transport chain) as the candidate pool and falls back to a same-category `search_products` when it is empty or nothing survives the mode filter. Heuristics: cheaper = strictly lower price, cheapest first; same-brand = brand match, then rating desc / price asc; better-specs = rating >= source (rating heuristic, not a spec-table comparison). Response shape live-verified 2026-10-06 (C7, see `docs/mobile-endpoint-coverage.md`).
- **`get_deals({category_id?, min_discount_percent?, limit?})`** (new read-only catalog tool, issue #13) — discounted products with current price, original price, savings and a discount % computed from the observed prices (never the marketing badge). Source (live-verified 2026-10-06): listing cards carry a crossed-out original price or an "Ušetříte N,-" amount; there is no Akce facet and the sale pages are product-less hubs. Bounded sample of listing pages, CZ-only (errors on other locales). See `docs/gap-analysis.md` and `docs/live-evidence/get-deals-2026-10-06.md`.
- **`autocomplete({query, limit?})` (catalog toolset, read-only; issue #14).** Alza's search-box suggestion endpoint was captured with Playwright (`page.keyboard.type`) as `GET webapi.alza.cz/api/anonymous/search/whisperer/v1/whisper` (anonymous, no token) and is called over plain HTTP through the existing CF-sidecar transport chain — no page render. Returns suggested phrases plus categories (`id`), brands (`id`), products (`id` + `code`) and articles, cached 5 min by normalised query. Live-verified 2026-10-06; documented as C15/C16 in `docs/mobile-endpoint-coverage.md`.
- `find_pickup_points` returns AlzaBox lockers without a cart or login ([#8](https://github.com/lukabudik/alza-mcp/issues/8)). They come from Alza's public locker-map API (`/api/salesNetwork/v1/places`), with one request per postal code, cached for 12 h. The default `types` merges lockers and showrooms by distance. Each locker includes its `parcelShopId`, and the first 10 lockers returned get opening hours from the per-locker detail (cached 1 h). The tool description says a standalone list can't tell whether a given (oversized) product fits.
- Slider (range) attribute filters ([#10](https://github.com/lukabudik/alza-mcp/issues/10), live-verified 2026-10-06). `search_products`'s `filters` now also takes `{param_id, min?, max?}` for Slider facets: screen size, refresh rate, brightness, response time, weight, dimensions, port counts, RAM, and so on. `list_category_filters` marks those groups `filterable: true, filterMode: "range"` and gives each step's raw `value`. A real mouse drag showed that Alza's category page keeps slider state in the URL hash (`#f&…&par{paramId}={from}--{to}`) and its JS then POSTs `/Services/EShopService.svc/Filter`. The MCP loads the hash URL, reads the page's own `Filter` reply, and returns the applied, step-snapped ranges as `appliedRanges`. With `category_id`, `min_screen_inches`/`max_screen_inches` now use the category's real diagonal slider (millimetres on monitors and laptops, inches on TVs). The product-name heuristic is only the fallback. See `docs/gap-analysis.md`.
- Streamable HTTP transport ([#16](https://github.com/lukabudik/alza-mcp/issues/16)): `alza-mcp --http [--port N] [--host H]` or `ALZA_TRANSPORT=http` serves the server at `/mcp` using the SDK's `StreamableHTTPServerTransport`. stdio is still the default. Each MCP session gets its own server instance, so toolset state, OAuth tokens and confirmation tokens are never shared. Only the `catalog` toolset is usable over HTTP; the others are listed as locked unless `ALZA_HTTP_ENABLE_ACCOUNT=1` is set. `ALZA_TOKEN_FILE` is not loaded over HTTP unless `ALZA_HTTP_ALLOW_TOKEN_FILE=1` is also set. Binds `127.0.0.1` with a `Host`/`Origin` allow-list, a session cap and idle expiry. The README covers running it locally and what hosting still needs, including the Cloudflare datacenter-IP problem.
- Price and stock watchdog tools: `watchdog_list`, `watchdog_set`, and `watchdog_delete`, in the new `watchdogs` toolset ([#17](https://github.com/lukabudik/alza-mcp/issues/17)). They wrap Alza's own watchdog, which emails the account address, so the MCP stores nothing. `watchdog_set` and `watchdog_delete` need a one-time `prepare_mutation` token, and no output includes the account email. The list and delete routes come from the user navigation and the per-product `watchdogDialog`. Create and delete were tested live on 2026-10-06 and no watchdog was left behind (rows B9/B9a/B9b, `docs/live-evidence/watchdog-b9-2026-10-06.md`).
- **`get_product_reviews` returns individual reviews (#9, 2026-10-06).** Reviews now come from `webapi.alza.cz/api/catalog/commodities/{id}/reviews` (commodity id from the product URL `-d####.htm` or `?dq=`), paged up to `limit` (max 50) with author, ISO date, rating, body, pros/cons, verified-purchase, variant and helpful count; the aggregate still comes from the product page. Any reviews-API failure falls back to the previous aggregate-only result.
- `npm run test:docker` (`scripts/docker-install-tests.sh`, `test/docker/`) is a clean-environment install harness. It packs the package, serves it from a local registry, and checks the following in fresh containers: `npx -y alza-mcp` and `npm install` on node 20/22/24 with and without python3 (postinstall, `.venv-cf`, sidecar files, stdio handshake); the README one-click badges driven through real VS Code and Cursor on clean profiles; the `.mcpb` bundle; the Streamable HTTP transport across containers; and `smithery.yaml`. It is not part of `npm test`. See CONTRIBUTING.md and `docs/live-evidence/docker-install-tests-2026-10-06.md`.
- PC builder ([#15](https://github.com/lukabudik/alza-mcp/issues/15)): new `pc_builder` toolset, off by default, with two tools.
  - **`pc_build_check`** fetches the specs of a parts list and returns live prices, the total and stock. It gives one verdict per compatibility rule (pass / warn / fail / unknown / not_applicable), with the spec values compared and the Czech spec row each came from. The rules: CPU socket ↔ motherboard, RAM generation / DIMM type / slots ↔ motherboard, RAM ↔ CPU, PSU wattage vs estimated draw + headroom, GPU length ↔ case, cooler height or radiator size ↔ case, cooler ↔ CPU socket, motherboard and PSU form factor ↔ case, and display output.
  - **`pc_build_suggest`** proposes a compatible build within a CZK budget (gaming / workstation / office profiles, `fixed_parts`, `cpu_vendor`). It picks from Alza's real component categories, and its product-detail fetches are bounded by `max_detail_fetches`.
  - The rules are pure, unit-tested functions in `src/domain/pc-build.ts`. Live evidence: `docs/live-evidence/2026-10-06-pc-builder.md`.
- **Distribution (2026-10-06).** Release workflow now verifies `server.json` / `mcpb/manifest.json` versions against `package.json` before `npm publish`, then publishes to the official MCP Registry with `mcp-publisher` (OIDC); `server.json` corrected from 0.1.2 to 0.3.0 and its description shortened to the registry's 100-char limit. README "Quick install" gains Cursor and VS Code one-click links; a Claude Desktop `.mcpb` bundle (`mcpb/manifest.json`, `scripts/build-mcpb.sh`) is built and attached to GitHub releases. `smithery.yaml` configSchema now matches the README env vars; `docs/directory-listings.md` holds ready-to-paste directory submission text.
- `npm version` now syncs `server.json` and `mcpb/manifest.json` to the new version (`scripts/sync-version.cjs`, the npm `version` lifecycle script; `npm run version:check` only reports). The `.mcpb` bundle now stages everything the npm package ships, including the Chrome-fingerprint sidecar `scripts/cf-transport.py`, so the bundle no longer loses the Cloudflare transport. `mcpb/manifest.json` follows `package.json`. `npm version` also updates the `VERSION` constant in `src/server.ts`.
- **Animated README demo (2026-10-06).** `docs/demo.gif` is rendered from a real `claude -p` session (search → detail → pickup point, catalog toolset only, no account). Reproduce with `scripts/record-demo-session.sh` + `scripts/render-demo-gif.py`; see `docs/demo-recording.md`.
- `Catalog.getProductSpecs`: the same page load as `get_product`, but it keeps up to 80 spec rows. `get_product` still returns at most 30.

### Changed
- `select_pickup_point` description ([#23](https://github.com/lukabudik/alza-mcp/issues/23)). A re-test on an authenticated cart on 2026-10-06 found no `beforeSelectAction`/`afterSelectAction` on any delivery. `getDeliveryAssociations` returns delivery → payment associations, not pickup points. The description now says this and points to `web_pickup_places` → `web_place_order` with `parcel_shop_id` for choosing an AlzaBox (`docs/live-evidence/select-pickup-point-auth-retest-2026-10-06.md`).
- `auth_exchange` accepts the full `alza://identity?code=…&state=…` redirect URL as `code` and reads `state` from it. Passing `state` is now optional in that case. The `auth_start` description and README explain the misleading "Při přihlášení došlo k chybě." message on desktop browsers (a client-side timer, not a failed sign-in) and how to get the redirect URL from DevTools ([#29](https://github.com/lukabudik/alza-mcp/issues/29)).

### Fixed
- `prepare_mutation` now accepts `cancel_order`. `cancel_order` requires that token but the action enum did not list it, so cancellation could not be confirmed.
- `mutate_list` no longer offers `set_watchdog`. It posted to the www `/api/watchdog/v1` route, which returns 404 (live 2026-10-06); use `watchdog_set` instead.
- An empty `ALZA_BASE_URL` (for example a cleared optional "Alza storefront" field in a Claude Desktop `.mcpb` bundle, whose manifest always passes `ALZA_BASE_URL=${user_config.base_url}`) no longer stops the server at startup with `Unsupported ALZA_BASE_URL: .`. Empty or blank values now mean "not set" and fall back to `https://www.alza.cz`. Found by the Docker install harness.
- `get_product` no longer caches a product with an empty spec list when the spec table had not rendered by the `load` event (seen live on 2026-10-06 for a PSU page). If neither the DOM table nor the JSON-LD `additionalProperty` has rows, it waits up to 4 s for the table and reads the page again.
- OAuth login from the npm package ([#29](https://github.com/lukabudik/alza-mcp/issues/29), [#30](https://github.com/lukabudik/alza-mcp/pull/30), thanks [@jankryh](https://github.com/jankryh)). `identity.alza.cz` is behind the same Cloudflare check as `www`, and `auth_start`/`auth_exchange` were getting HTTP 403. The package now ships the Chrome-fingerprint sidecar (`scripts/cf-transport.py`, `scripts/ensure-cf-venv.sh`) and the auth scripts, and `postinstall` sets up the `curl_cffi` venv when `python3` is present. OAuth discovery, token exchange and refresh go through the sidecar, and `URLSearchParams` bodies no longer skip it. If the sidecar is unavailable, OAuth uses plain fetch. If discovery fails, it uses the APK default endpoints instead of stopping.

## [0.3.1] — 2026-10-05

### Added
- README **Contributors** section, thanking [@samuelseidel](https://github.com/samuelseidel).
- Roadmap tracked as GitHub issues ([#8](https://github.com/lukabudik/alza-mcp/issues/8)–[#23](https://github.com/lukabudik/alza-mcp/issues/23)), plus feature-request and PR templates.
- Daily live canary workflow (`.github/workflows/live-canary.yml`). It runs `validate:api` against alza.cz and opens (or comments on) a `canary` issue when checks fail. GitHub-hosted runners get Cloudflare's interactive challenge, so they only report the block. Set the `CANARY_RUNS_ON` variable to a self-hosted runner to get real results.
- `validate:api` now covers price-sorted and brand-filtered search, product params, sub-level categories and category filters. It retries each failed check once, prints a markdown summary (`--markdown <file>`), and exits 2 (not 1) when Cloudflare challenges the machine.

### Changed
- README: removed the stale note saying npm serves 0.2.0.
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
