# Roadmap

Things we'd like to build, in rough priority order. Open an issue or PR if you want to pick something up.

## Near-term (v0.2)

- [ ] **AlzaBox locker discovery.** DOM-scrape `https://www.alza.cz/alzabox.htm` (the public locker map) and surface lockers in `find_pickup_points` alongside showrooms.
- [ ] **Individual review bodies.** `get_product_reviews` currently returns the JSON-LD aggregate (`ratingValue`, `reviewCount`). The reviews tab loads bodies dynamically — wire up a click + scrape pass.
- [ ] **Spec-param extraction.** Parse the per-product spec table on the detail page into the structured `params` array. Unblocks the v0.4 PC builder.
- [ ] **Daily `validate-api` cron.** Hosted GitHub Action that runs the integration suite and opens an issue on drift.

## Medium-term (v0.3 — discovery features)

- [ ] **`compare_products`** — fetch N products in parallel, build a side-by-side spec table.
- [ ] **`recommend_alternatives`** — same category + closest spec match, modes for `cheaper` / `better-specs` / `same-brand`.
- [ ] **`get_deals`** — sale categories, min discount filter.
- [ ] **`autocomplete`** — search-suggestion strings to help the agent refine queries before committing to a full search.

## Longer-term (v0.4+)

- [ ] **PC builder** — Alza is the dominant Czech PC-parts retailer. A multi-step tool that picks CPU → enforces socket → filters mobos → checks RAM type → checks PSU wattage budget → checks case clearance for cooler. Pulls structured spec params from the detail pages. The headline power-user feature.
- [ ] **Price watchlist** — durable subscriptions (Upstash Redis on a hosted instance), daily cron, webhook on threshold hit.
- [ ] **Streamable HTTP transport** — same code on Vercel via `mcp-handler` so users without a local browser can use a hosted instance. Hosted version would need to defeat CF from a datacenter IP, likely via Browserbase or a residential-proxy lane.
- [ ] **Compare via MCP `sampling`** — let the server ask the agent's LLM to summarize a comparison instead of just emitting a table.

## Conditional / bigger commitment

- [ ] **Write actions** (cart / order / login) via MCP URL-mode elicitation for BYO credentials. **Only if there's clear demand and we can do it safely.** Read-only-forever is a respectable end state too.

## Distribution

- [ ] **npm publish** as `alza-mcp`.
- [ ] **Registry submissions** — Smithery, mcp.so, PulseMCP, Glama, the official `modelcontextprotocol/servers` README.
- [ ] **Demo video / GIFs** in the README.
- [ ] **One-click "Add to Claude" deeplink** in the README.
