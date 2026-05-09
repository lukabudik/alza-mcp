# alza-mcp

> An unofficial **Model Context Protocol** server for [Alza.cz](https://www.alza.cz) — gives AI agents a clean, read-only interface for browsing one of Central Europe's largest e-commerce catalogs.

[![npm version](https://img.shields.io/npm/v/alza-mcp.svg)](https://www.npmjs.com/package/alza-mcp)
[![CI](https://github.com/lukabudik/alza-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lukabudik/alza-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Ask Claude (or any MCP-aware agent) "find me a quiet 14-inch laptop under 30 000 Kč with good reviews and the closest place I can pick it up" — and it actually can.

> [!IMPORTANT]
> This project is **unofficial** and not affiliated with, endorsed by, or sponsored by Alza.cz a.s. It is a community wrapper for personal and research use. Read the [disclaimer](#disclaimer) before deploying or sharing widely.

---

## What it does

Five focused tools, all read-only, no credentials required:

| Tool | What it does |
|---|---|
| **`search_products`** | Keyword search across the catalog with filters (price range, sort, category) |
| **`get_product`** | Full details for one product — price, availability, specs, brand, image, URL |
| **`get_product_reviews`** | Aggregate rating + review count (individual review bodies — v0.2) |
| **`find_pickup_points`** | Nearest brick-and-mortar AlzaShop showrooms by postal code (AlzaBox lockers — v0.2) |
| **`list_categories`** | 20 top-level Alza categories with ids — feed `category_id` to `search_products` to narrow results |

Plus:

- 📦 **Resource** `alza://product/{code}` — same product data as a browseable URI.
- 💬 **Prompt** `/find-product` — guided shopping helper that orchestrates the tools above.
- 🌍 **Multi-locale** — works for `alza.cz`, `.sk`, `.hu`, `.at`, `.de`, `.co.uk` via one env var.

---

## Install

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "alza": {
      "command": "npx",
      "args": ["-y", "alza-mcp"]
    }
  }
}
```

After install, run `npx playwright install chromium` once — the first tool call needs Chromium (~92 MB headless-shell). Restart Claude Desktop.

### Claude Code

```bash
claude mcp add alza --scope user -- npx -y alza-mcp
```

### Cursor / Continue / other MCP clients

Same shape — `command: "npx"`, `args: ["-y", "alza-mcp"]`. Any MCP client that supports stdio transport works.

### Optional config (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `ALZA_BASE_URL` | `https://www.alza.cz` | Switch locale. One of `https://www.alza.cz`, `.sk`, `.hu`, `.at`, `.de`, `.co.uk`. |
| `ALZA_CDP_URL` | _unset_ | Connect to your already-running Chrome via CDP instead of launching a managed Chromium. Inherits your session, faster cold starts, no Chromium download. Launch Chrome with `--remote-debugging-port=9222` and set `ALZA_CDP_URL=http://localhost:9222`. |
| `ALZA_HEADLESS` | `true` | Set to `false` to run a visible browser (debugging only). |
| `ALZA_DEBUG` | `false` | Verbose stderr logging. |

---

## Usage examples

> **You:** I need a quiet mechanical keyboard under 3000 Kč.
>
> **Agent:** *(calls `search_products` with query="quiet mechanical keyboard", max_price=3000, sort="rating")*
> Three options at Alza:
> 1. **Keychron K8 Pro** — 2 990 Kč, ★ 4.7 (218 reviews) — `[code QC453ax1]`
> 2. **Logitech MX Mechanical Mini** — 2 890 Kč, ★ 4.6 — `[code LO321aQ8]`
> 3. **Razer Pro Type Ultra** — 2 490 Kč, ★ 4.4 — `[code RZ889o12]`
>
> Want me to pull full specs and reviews for one of these?

> **You:** Where can I pick up an order in Brno?
>
> **Agent:** *(calls `find_pickup_points` with postal_code="60200")*
> **AlzaShop Brno** (showroom) · 1.2 km · Vídeňská 100, 619 00 Brno

---

## How it works

There is **no public consumer API** for Alza. The mobile app's REST endpoints exist, but Alza runs Cloudflare Bot Management in challenge mode on top of them — plain HTTP clients get 403, even with the right mobile-app User-Agent. (Note: this is not the case for most other CEE retailers; e.g. [rohlik-mcp](https://github.com/tomaspavlin/rohlik-mcp) wraps Rohlik over plain HTTP because Rohlik runs CF in passive mode. Alza is one of the few that defends its catalog actively.)

Rather than fight Cloudflare, **`alza-mcp` drives a real browser**:

1. **Playwright + headless Chromium** — Cloudflare lets a real browser through; we just *are* one. No fingerprint games, no proxy dependencies, no cat-and-mouse with bot-detection rules.
2. **Catalog tools navigate `https://www.alza.cz/search.htm?exps=...`** and scrape the result cards (`.browsingitem` × 24, with stable `data-code` attributes).
3. **Product details come from the page's JSON-LD `Product` schema** — the same SEO data Google uses for rich snippets. Stable, structured, no DOM-selector roulette.
4. **Reviews use the JSON-LD `aggregateRating`** for average + count. (Individual review bodies are loaded dynamically on the reviews tab — v0.2.)
5. **Pickup points** combine a curated branch dataset with geocoding via [Nominatim](https://nominatim.openstreetmap.org/). AlzaBox locker discovery is planned for v0.2 (DOM scrape of [`alza.cz/alzabox.htm`](https://www.alza.cz/alzabox.htm)).
6. **Caching** — search 60 s, product 15 min, categories 24 h, code-to-URL 1 h. Per-process LRU.

The browser launches lazily on the first tool call, pages are pooled, and image / font / analytics traffic is blocked at the route level — every search is one HTML payload, no media. Typical latencies: search ~2 s, product detail ~5 s warm, categories ~20 s cold.

```
┌────────────────────────────────────────────┐
│ stdio transport (npx alza-mcp)             │
├────────────────────────────────────────────┤
│ MCP tools / resources / prompts            │
├────────────────────────────────────────────┤
│ Domain: catalog · reviews · pickup         │
├────────────────────────────────────────────┤
│ Infra:                                     │
│  • browser (Playwright, page pool, CDP)    │
│  • jsonld (schema.org parser)              │
│  • cache (LRU + TTL)                       │
│  • locale (multi-country)                  │
└────────────────────────────────────────────┘
```

### Why a browser is the right answer

Datacenter and casual-residential clients hit a Cloudflare JS challenge on every Alza request. Working around that requires one of: a residential-proxy network (paid), a TLS-impersonation library plus solver (fragile, often broken), an external CF-bypass service (Docker-heavy or paid), or a real browser. The first three lose against CF rule updates. A real browser doesn't lose because there's nothing to lose against — it really is a browser.

The cost is install footprint (~92 MB Chromium on first run) and per-call latency (a few seconds, not milliseconds). For a shopping assistant this is the right trade — humans don't shop in milliseconds either.

---

## Development

```bash
git clone https://github.com/lukabudik/alza-mcp.git
cd alza-mcp
npm install
npx playwright install chromium
npm test                # unit tests (no network)
npm run typecheck
npm run build           # → dist/
npm run validate:api    # hits real Alza — runs every tool end-to-end
node dist/index.js      # run the server (waits for stdio MCP messages)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the layout and how to add a tool.

---

## Roadmap

The current release is intentionally small and read-only. Things on the roadmap, in rough priority order:

- [ ] **AlzaBox locker discovery** — DOM-scrape `alza.cz/alzabox.htm` to surface lockers in `find_pickup_points`.
- [ ] **Individual review bodies** — load the reviews tab and scrape each entry, not just the aggregate.
- [ ] **Streamable HTTP transport** + hosted endpoint on Vercel — runs the same code remotely so users don't need a local browser. Hosted instance would use Vercel + Browserbase or a residential-proxy lane to defeat CF from a datacenter IP.
- [ ] **Daily `validate-api` cron** with Slack/Discord drift alerts.
- [ ] **Compare / recommend / deals** tools — multi-product comparison, "find me alternatives to X", and curated daily deals.
- [ ] **PC builder** — socket / RAM / wattage / clearance compatibility engine over Alza's spec parameters. (Alza is the dominant Czech PC-parts retailer; this is the obvious power-user feature.)
- [ ] **Price watchlist** — durable subscriptions, daily cron, webhook on threshold.
- [ ] **Spec-param extraction** — pull the per-product spec table into structured `params` array.
- [ ] **Write actions** (cart / order) via MCP URL elicitation for BYO-credentials. **Conditional** — only if there's clear demand and we can do it safely. Read-only-forever is also a respectable end state.
- [ ] **Registry submissions** — Smithery, mcp.so, PulseMCP, Glama, official `modelcontextprotocol/servers` README.

---

## FAQ

### Why the 92 MB Chromium download?

Cloudflare's Bot Management checks more than just User-Agent — it runs a JavaScript challenge that only a real browser can solve. We tried mimicking the official Alza Android app with `okhttp` and the right cookies (the recipe used by [topmonks/hlidac-shopu](https://github.com/topmonks/hlidac-shopu/tree/main/actors/alza)) and it works — *if* you call from Apify's residential proxy network. From any laptop or datacenter you get 403s. Driving a real headless Chrome was the only approach that worked end-to-end without external dependencies. See [How it works](#how-it-works) for the full reasoning.

### Why no purchasing / cart / login?

Three reasons:
1. **Trust** — running an MCP server that holds your Alza credentials is a much higher bar than a read-only catalog browser.
2. **Stability** — the cart/order flow is the most likely to break with frontend updates.
3. **Scope** — agents that *help you research* are useful even without `place_order`. Click "Buy" yourself when you're ready.

### Can I avoid the Chromium download?

Yes. Set `ALZA_CDP_URL` to your existing Chrome's debug port:

```bash
# launch Chrome with debugging
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222
# tell alza-mcp to attach
ALZA_CDP_URL=http://localhost:9222 npx alza-mcp
```

The MCP will use *your* Chrome — no separate download, faster cold starts, and it inherits any Alza cookies you already have.

### Will Alza take this down?

The project identifies itself in `User-Agent`, caches aggressively to minimize traffic, has no commercial intent, and provides a takedown contact path via [issues](https://github.com/lukabudik/alza-mcp/issues). If Alza requests removal, we'll comply.

### How does this compare to rohlik-mcp?

[tomaspavlin/rohlik-mcp](https://github.com/tomaspavlin/rohlik-mcp) is the inspiration. Differences:
- Rohlik isn't behind a Cloudflare challenge → rohlik-mcp uses plain HTTP. We're forced to a real browser because Alza is.
- Alza is a much larger catalog (millions of SKUs vs. a grocery list).
- We're read-only by design; rohlik-mcp ships cart actions because the use case is recurring grocery orders.
- We expose MCP **resources** and **prompts** in addition to tools.

---

## Disclaimer

`alza-mcp` is **not affiliated with, endorsed by, or sponsored by Alza.cz a.s.** "Alza", "Alza.cz", and "AlzaBox" are trademarks of their respective owners.

This project drives a real browser to render publicly accessible Alza pages — the same pages a human visitor sees. The maintainers make no guarantees of availability, accuracy, or fitness for any purpose. Use at your own risk; do not rely on this for commercial decisions.

If you are an Alza employee and have concerns, please open an issue or reach out — we will respond promptly.

---

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

- [tomaspavlin/rohlik-mcp](https://github.com/tomaspavlin/rohlik-mcp) — direct inspiration; ditto layout patterns.
- [topmonks/hlidac-shopu](https://github.com/topmonks/hlidac-shopu) — reference Alza scraper recipe (HTTP + proxies).
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) — the official Playwright MCP server, proof that a browser-driven MCP is the right abstraction for a lot of websites.
- [Model Context Protocol](https://modelcontextprotocol.io) and the [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
