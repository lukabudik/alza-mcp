# Roadmap

Rough priority order. Every item is a GitHub issue — comment there before starting so work isn't duplicated. New to the project? Start with [`good first issue`](https://github.com/lukabudik/alza-mcp-community/labels/good%20first%20issue).

## Shipped

- **Catalog** — search with price/stock/screen-size filters and client-side sort, real pagination, product detail with spec params (DOM + JSON-LD), aggregate rating plus individual review bodies, category tree, checkbox and slider (range) facet filters (`list_category_filters`), EAN lookup, AlzaBox lockers and showroom pickup points without a cart.
- **Discovery tools** — `compare_products` (side-by-side spec table with an optional MCP-sampling summary), `recommend_alternatives`, `get_deals`, `autocomplete`.
- **Account & checkout** — OAuth PKCE sign-in, cart, delivery/AlzaBox selection, checkout preview, order placement (legacy web WCF path) and cancellation, after-order payments, order history/documents, claims, subscriptions, profile/addresses and credential changes — all high-impact mutations behind one-time confirmation tokens.
- **Progressive disclosure** — tools grouped into toolsets; only `catalog` and `auth` are enabled by default.
- **Streamable HTTP transport** — `alza-mcp-community --http` for local multi-session use (catalog-only unless account access is opted in).
- **Distribution** — published on npm as `alza-mcp-community`, CI on Node 20/22, trusted publishing on tag push; `server.json` and `smithery.yaml` in the repo, published to the official MCP Registry from the release workflow ([#19](https://github.com/lukabudik/alza-mcp-community/issues/19), 0.4.0).

## Near-term

- [#20](https://github.com/lukabudik/alza-mcp-community/issues/20) List in MCP directories (Smithery, Glama, PulseMCP, mcp.so)
- [#22](https://github.com/lukabudik/alza-mcp-community/issues/22) One-click install links (Cursor, VS Code, Claude Desktop)

## Medium-term

- [#17](https://github.com/lukabudik/alza-mcp-community/issues/17) Price watchlist — native watchdog tools (`watchdog_list/set/delete`) shipped; approach sign-off and a self-hosted watchlist remain

## Long-term

- [#15](https://github.com/lukabudik/alza-mcp-community/issues/15) PC builder — `pc_build_check` / `pc_build_suggest` shipped in the `pc_builder` toolset; design-note sign-off, facet-based candidate filtering (blocked by Alza redirects) and latency remain
- Hosted HTTP endpoint (follow-up to [#16](https://github.com/lukabudik/alza-mcp-community/issues/16); local `--http` mode shipped — Cloudflare blocks datacenter IPs, see docs/gap-analysis.md)

Known limitations and dead ends (with dated evidence) live in [docs/gap-analysis.md](docs/gap-analysis.md). Ideas not listed here: open a [feature request](https://github.com/lukabudik/alza-mcp-community/issues/new/choose).
