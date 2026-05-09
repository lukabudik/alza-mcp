# alza-mcp — Plan

An unofficial, community **Model Context Protocol** server that gives AI agents a clean read-only interface to **Alza.cz** — the largest Czech / CEE e-commerce retailer. The goal is simple: let an LLM help a human shop on Alza — search, compare, find the right pickup point — without touching credentials or making purchases.

Inspired by [tomaspavlin/rohlik-mcp](https://github.com/tomaspavlin/rohlik-mcp). Read-only, stdio-first, no auth.

---

## 1. Scope (v1)

**Five tools, all read-only, no credentials.**

| Tool | Purpose |
|---|---|
| `search_products` | Keyword search across the Alza catalog |
| `get_product` | Full detail for a single product (price, availability, specs, images) |
| `get_product_reviews` | Reviews + aggregate rating |
| `find_pickup_points` | Nearest AlzaBox lockers + brick-and-mortar branches by postal code |
| `list_categories` | Browse the category tree (helps the agent build filtered searches) |

**Plus, to make it feel like a real connector and not a CLI in disguise:**
- 1 MCP **resource** — `alza://product/{code}` — same product data, browseable as a URI.
- 1 MCP **prompt** — `/find-product` — guided shopping helper template.

---

## 2. Why this is a good reference repo

This codebase aims to be a quality bar for "community MCP server wrapping a website with no public API." Concretely:

1. **Cloudflare-aware HTTP client as a reusable, well-tested module** — exact mobile-app fingerprint (UA, cookies, handshake order), cookie jar, retry with jitter, proxy escape valve. Most MCP examples wave their hands at this; we treat it as the actual hard problem.
2. **Hybrid data sources** — REST endpoint for search/listing, JSON-LD scrape for reviews, **official OpenAPI** for AlzaBox lockers. Three different contracts behind one clean surface, with each tool mapped to the most stable source available.
3. **Per-tool factory pattern** — every tool lives in its own file, exporting `{name, definition, handler}` from a `createXxxTool` factory. Schema, description, and handler co-located. Easy to grep, easy to add.
4. **Structured + textual output** (MCP `2025-06-18`+) — every tool returns `structuredContent` (typed JSON) **and** `content[].text` (Markdown summary). The agent gets clean data; humans reading the chat get readable prose.
5. **i18n on day one** — switch base URL via env (`ALZA_BASE_URL`) for `.cz`, `.sk`, `.hu`, `.at`, `.de`, `.co.uk`. `Accept-Language` and currency derive from it.
6. **Self-monitoring `validate-api` script** — manual integration test (and later, hosted cron) that hits every endpoint and produces a pass/fail report. When Alza ships a frontend update, this is what tells you what broke before users do.
7. **Caching** — per-process LRU with TTL by data type (search 60 s, product 15 min, categories 24 h, branches 7 d). Politeness to upstream + faster tools.
8. **Honest engineering** — no pretending the API is stable. README has a clear unofficial-disclaimer, `User-Agent` identifies the bot, every breaking error returns a graceful `isError: true` instead of crashing.

What we're **not** doing (deliberately): no cart/order, no credentials, no PC-builder, no price watchlist, no MCP sampling. Those are roadmap items, kept out of v1 to ship a tight, focused thing.

---

## 3. Architecture

```
┌──────────────────────────────────────────────┐
│ stdio transport (npx alza-mcp)               │
├──────────────────────────────────────────────┤
│ MCP server                                   │
│  • tools/      one file per tool             │
│  • resources/  alza://product/{code}         │
│  • prompts/    /find-product                 │
├──────────────────────────────────────────────┤
│ Domain                                       │
│  • catalog.ts     search, product detail     │
│  • reviews.ts     JSON-LD review scrape      │
│  • pickup.ts      AlzaBox + branches         │
├──────────────────────────────────────────────┤
│ Infrastructure                               │
│  • alza-client.ts  CF-aware fetch + cookies  │
│                    + handshake + retry       │
│  • locale.ts       base URL → lang/currency  │
│  • jsonld.ts       schema.org parser         │
│  • cache.ts        LRU + TTL                 │
│  • errors.ts       typed errors              │
└──────────────────────────────────────────────┘
```

**Stack**
- TypeScript strict, ESM, Node ≥ 20
- `@modelcontextprotocol/sdk` (^1.26)
- `zod` 3 — every input field has `.describe()`
- `undici` — built-in cookie support, better than node-fetch for our use
- `cheerio` — HTML/JSON-LD parsing
- `vitest` — unit + an integration `validate-api` script
- No frameworks, no build complexity. `tsc → dist`. `npx alza-mcp` runs the binary.

**Data sources, mapped to tools**

| Tool | Primary | Fallback | Reliability |
|---|---|---|---|
| `search_products` | `POST /Services/RestService.svc/v2/products` (FULLTEXT) | HTML scrape of `/search.htm` | Medium — REST is what Alza Android app uses; CF protected but mobile fingerprint passes |
| `get_product` | `POST /Services/RestService.svc/v2/products` by id | JSON-LD on product page | Medium |
| `get_product_reviews` | JSON-LD `AggregateRating` on product page | scrape review tab | High — JSON-LD is SEO infrastructure, very stable |
| `find_pickup_points` | **Official AlzaBox OpenAPI** + static branches dataset | — | High |
| `list_categories` | `GET /Services/RestService.svc/v1/category/{id}` | static cached snapshot | Medium |

---

## 4. The Cloudflare client — heart of the project

Direct quote from research: every `*.alza.cz` host is behind Cloudflare Bot Management with active challenge. Plain `curl` → 403 + interstitial. Mobile-app `okhttp/4.12.0` UA + the right cookies + the right call order → 200 OK. The recipe (cribbed from [topmonks/hlidac-shopu](https://github.com/topmonks/hlidac-shopu/tree/main/actors/alza)) is:

1. **First-touch handshake**, on demand, cached for ~30 min:
   - `GET /Services/RestService.svc/v1/getAllDeliveryCountries?country=CZ`
     → server returns `Set-Cookie` for `__cf_bm`, `_cfuvid`, `VST`, `lb_id`. We capture them.
   - `POST /Services/RestService.svc/v1/setCountry?country=CZ` with body `{"countryId":0}`.
2. **All subsequent requests** carry:
   ```
   User-Agent: okhttp/4.12.0;unknown/Generic_Android-x86_64;13;cs_CZ;2025.17.0;436;0;cz.alza.eshop
   Accept: application/json
   Accept-Encoding: gzip
   Content-Type: application/json; charset=utf-8
   Cookie: platform=androidtablet; ApV22=2; VST=...; __cf_bm=...
   ```
3. **Throttled**: ≥ 100 ms between calls (matches rohlik-mcp's polite-bot pattern).
4. **Retried**: 3 attempts, exponential backoff with jitter, only on 429 / 5xx / a CF challenge body.
5. **Detected**: if response body contains the CF challenge HTML (`<title>Just a moment...</title>`), throw a typed `CloudflareChallengeError` so callers can return a clean MCP error instead of crashing.
6. **Proxy hook**: `ALZA_PROXY_URL` env var, off by default. Lets users self-host with a residential proxy if/when CF tightens.

This module is the most-tested, most-documented file in the repo.

---

## 5. Distribution & install (v1)

```jsonc
// Claude Desktop:  ~/Library/Application Support/Claude/claude_desktop_config.json
// Claude Code:     .mcp.json or per-IDE config
{
  "mcpServers": {
    "alza": {
      "command": "npx",
      "args": ["-y", "alza-mcp"]
    }
  }
}
```

That's it. No auth, no env vars required. Optional `ALZA_BASE_URL` for non-CZ markets, `ALZA_PROXY_URL` for self-hosted proxy.

---

## 6. Roadmap (post-v1, future)

- **Streamable HTTP transport** — same code on Vercel via `mcp-handler`, hosted at a stable URL.
- **Vercel Runtime Cache + Cron** for `validate-api` and price-history collection.
- **Watchlist / price alerts** — durable watches, daily cron, webhook notifications.
- **PC builder** — socket / RAM / wattage / clearance compatibility engine over Alza's spec params.
- **More tools** — `compare_products`, `recommend_alternatives`, `get_deals`.
- **Write actions** — cart / order via MCP elicitation-based BYO-credential flow. Big commitment, deliberate decision.
- **Listings** — Smithery, mcp.so, PulseMCP, Glama, official `modelcontextprotocol/servers` README.

---

## 7. Risks & honest disclaimers

| Risk | Mitigation |
|---|---|
| Cloudflare blocks our IPs | Mobile-app fingerprint, handshake recipe, residential-proxy hook, graceful 503 |
| Alza shifts endpoints | `validate-api` script catches drift early; per-call typed errors; JSON-LD fallback |
| Alza ToS / cease-and-desist | README disclaimer, identifying User-Agent (`alza-mcp/x.y +github.com/...`), aggressive caching, no commercial intent, takedown contact |
| LLM hallucinates product codes | All tool outputs include canonical `code` from upstream; `get_product` validates |
| Maintenance churn | Tight scope (5 tools), self-monitoring script, per-tool isolation so one breakage doesn't take the rest down |

**This is not affiliated with or endorsed by Alza.cz a.s.** It's a community wrapper for personal/research use.
