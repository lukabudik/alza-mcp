# Roadmap

Rough priority order. Every item is a GitHub issue — comment there before starting so work isn't duplicated. New to the project? Start with [`good first issue`](https://github.com/lukabudik/alza-mcp/labels/good%20first%20issue).

## Shipped

- **Catalog** — search with price/stock/screen-size filters and client-side sort, real pagination, product detail with spec params (DOM + JSON-LD), aggregate reviews, category tree, checkbox facet filters (`list_category_filters`), EAN lookup, showroom pickup points.
- **Account & checkout** — OAuth PKCE sign-in, cart, delivery/AlzaBox selection, checkout preview, order placement (legacy web WCF path) and cancellation, after-order payments, order history/documents, claims, subscriptions, profile/addresses and credential changes — all high-impact mutations behind one-time confirmation tokens.
- **Progressive disclosure** — tools grouped into toolsets; only `catalog` and `auth` are enabled by default.
- **Distribution** — published on npm as `alza-mcp`, CI on Node 20/22, trusted publishing on tag push; `server.json` and `smithery.yaml` in the repo.

## Near-term

- [#8](https://github.com/lukabudik/alza-mcp/issues/8) Standalone AlzaBox locker discovery in `find_pickup_points`
- [#9](https://github.com/lukabudik/alza-mcp/issues/9) Individual review bodies in `get_product_reviews`
- [#10](https://github.com/lukabudik/alza-mcp/issues/10) Slider-type (range) category filters
- [#23](https://github.com/lukabudik/alza-mcp/issues/23) Re-test `select_pickup_point` against an authenticated session
- [#19](https://github.com/lukabudik/alza-mcp/issues/19) Publish to the official MCP Registry from the release workflow
- [#20](https://github.com/lukabudik/alza-mcp/issues/20) List in MCP directories (Smithery, Glama, PulseMCP, mcp.so)
- [#21](https://github.com/lukabudik/alza-mcp/issues/21) Animated demo in the README
- [#22](https://github.com/lukabudik/alza-mcp/issues/22) One-click install links (Cursor, VS Code, Claude Desktop)

## Medium-term — discovery tools

- [#11](https://github.com/lukabudik/alza-mcp/issues/11) `compare_products` — side-by-side spec table
- [#12](https://github.com/lukabudik/alza-mcp/issues/12) `recommend_alternatives` — cheaper / better specs / same brand
- [#13](https://github.com/lukabudik/alza-mcp/issues/13) `get_deals` — discounted products
- [#14](https://github.com/lukabudik/alza-mcp/issues/14) `autocomplete` — search suggestions
- [#17](https://github.com/lukabudik/alza-mcp/issues/17) Price watchlist via Alza's native watchdog

## Long-term

- [#15](https://github.com/lukabudik/alza-mcp/issues/15) PC builder — socket / RAM / wattage / clearance compatibility engine
- [#16](https://github.com/lukabudik/alza-mcp/issues/16) Streamable HTTP transport and a path to a hosted endpoint
- [#18](https://github.com/lukabudik/alza-mcp/issues/18) Summarise comparisons with MCP sampling

Known limitations and dead ends (with dated evidence) live in [docs/gap-analysis.md](docs/gap-analysis.md). Ideas not listed here: open a [feature request](https://github.com/lukabudik/alza-mcp/issues/new/choose).
