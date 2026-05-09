# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
