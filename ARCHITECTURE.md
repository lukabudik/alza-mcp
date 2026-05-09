# Architecture

This is a deeper companion to the [README](README.md) — written for contributors who want to understand *why* the code looks the way it does.

## The core problem

Alza.cz has no public consumer API. There are three official surfaces — Alza Trade (B2B marketplace, OAuth-gated), AlzaBox (parcel-locker logistics, OpenAPI'd), and the affiliate program (links/creatives only) — none of which lets a third party query the catalog.

The mobile app's REST endpoints under `/Services/RestService.svc/` are the de-facto data plane and have been documented by community projects ([topmonks/hlidac-shopu](https://github.com/topmonks/hlidac-shopu/tree/main/actors/alza)). But Alza protects them with **Cloudflare Bot Management in challenge mode** — every call from a casual datacenter or residential client returns `403` with a JS challenge. Solving the challenge requires running JavaScript in a real browser.

Three approaches we considered and rejected:

| Approach | Verdict |
|---|---|
| **HTTP + okhttp UA + `__cf_bm`/`VST` cookie handshake** (the topmonks recipe) | Works **only** through Apify's residential proxy network. Direct calls fail. Not viable for a free `npx` install. |
| **TLS-impersonation libraries** (`cycletls`, `tls-client`, `curl-impersonate`) | Useful for sites where the challenge is downgrade-able by mobile UA + cookies. CF challenge mode requires JS execution; TLS fingerprinting alone isn't enough. |
| **External CF-bypass services** (FlareSolverr, ZenRows) | Either a Docker dependency or a paid SaaS. Neither fits the "community OSS, one-line install" goal. |

The **fourth approach — drive a real browser via Playwright — is what we ship.** Cloudflare lets a real browser through; we just *are* one. The cost is a ~92 MB Chromium download on first install and a few seconds of latency per call. For a shopping assistant, that's the right trade.

## Module map

```
src/
  index.ts             stdio entrypoint, signal handling
  server.ts            buildServer() — wires deps, registers tools/resources/prompts
  infra/
    browser.ts         Playwright facade — lazy launch, page pool, CDP attach
    locale.ts          base URL → Accept-Language + currency mapping
    jsonld.ts          schema.org parser (Product, Offer, Review, AggregateRating)
    cache.ts           tiny LRU + TTL with async memoize()
    errors.ts          typed errors (NotFound, Upstream, Cloudflare, Handshake)
    logger.ts          stderr-only structured JSON logging
  domain/
    catalog.ts         search / getProduct / listCategories
    reviews.ts         getProductReviews via JSON-LD AggregateRating
    pickup.ts          findPickupPoints — branch dataset + Nominatim geocoding
    types.ts           shared domain types
  data/branches.ts     curated AlzaShop showroom dataset
  tools/               one file per MCP tool — Zod schema + handler in one place
  resources/           alza:// URI handlers
  prompts/             /find-product slash-command template
```

`infra/` knows about HTTP, cookies, browsers. `domain/` orchestrates business operations. `tools/` is the MCP surface — every tool delegates to `domain/`. The boundary keeps test friction down: domain modules can be exercised against fixtures; the browser layer is exercised end-to-end via `npm run validate:api`.

## Tool design

Every tool returns:

1. `structuredContent` — typed JSON for the agent. This is what the LLM works with programmatically.
2. `content[].text` — Markdown summary for the chat UI. This is what the human reading the conversation sees.

Every Zod field has `.describe()` — that text is what the model reads when deciding *whether and how* to call the tool. Vague descriptions = bad tool calls.

All read tools carry `readOnlyHint: true`. Idempotent calls (resolved by ID, like `get_product`) carry `idempotentHint: true`. We have no destructive tools in v0.1; if/when we add `add_to_cart` etc., they'll carry `destructiveHint: true` and require an explicit `confirm: true` argument plus user-side elicitation.

## Caching

Per-process LRU + TTL, no external dependencies:

| Key | TTL | Why |
|---|---|---|
| `search:{queryHash}` | 60 s | Same query a few seconds apart usually wants the same answer; new searches every minute is plenty fresh |
| `product:{code}` | 15 min | Prices and availability shift, but rarely within a 15-min user session |
| `category-tree` | 24 h | Top-level categories are stable for years |
| `code → URL` (search-derived) | 1 h | Lets `get_product` skip the search step on warm calls |

## Data hydration strategy

Search uses **DOM scraping** — `.browsingitem` cards on the search HTML page have stable `data-code`/`data-id` attributes plus reliably-classed inner anchors and price text. 24 cards per page; we strip sponsored items.

Product detail uses **JSON-LD** — every product page embeds a `Product` schema for SEO with `name`, `sku`, `brand`, `offers.{price, priceCurrency, availability}`, `aggregateRating.{ratingValue, reviewCount}`, and `image[]`. SEO data is more stable than DOM markup; Alza won't break Google rich snippets without a strong reason.

Categories use a stable selector pattern (`li[class*="category-naviga"] a`) on the homepage MUI navigation list.

## Errors

The browser layer throws `Error` for technical failures (timeouts, network); the domain layer throws typed errors (`NotFoundError`, `UpstreamError`); the MCP wrapper in `server.ts` converts everything to `{ isError: true, content: [...] }` so the agent sees a clean error message instead of a crash. We never let the server die — a flaky catalog endpoint should not take down the whole MCP.

## Resilience

Two things will inevitably break: Alza redesigning the catalog DOM, and Cloudflare tightening rules.

For **DOM drift**, `npm run validate:api` runs every tool against live Alza and exits non-zero if any of them returns nothing or throws. Run it after major Alza app updates; once we have hosted infra it'll be a daily cron.

For **bot-protection escalation**, the next levers are: switch to a stealth-patched Playwright fork (`patchright`, `rebrowser-playwright`); add proxy support (`HTTPS_PROXY` already plumbs through Playwright); document a `ALZA_CDP_URL` workflow that uses the user's own logged-in Chrome.

## Anti-features

Things we deliberately don't do:

- **No login / cart / order.** Read-only forever (or until there's a clear demand we can fulfill safely).
- **No undocumented mobile-API endpoint reuse.** Plenty of older scrapers do this; we lose them on every CF rule update. The browser path is more honest and more resilient.
- **No background scraping or pre-fetching.** Every tool call corresponds to a user request.
- **No analytics / telemetry.** Stderr logs only, structured JSON, opt-in via `ALZA_DEBUG=true`.
- **No bundled proxy lists.** If you need a proxy, set `HTTPS_PROXY` yourself.
