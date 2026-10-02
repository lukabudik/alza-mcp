# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
