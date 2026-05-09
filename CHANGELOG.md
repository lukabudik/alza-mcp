# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
