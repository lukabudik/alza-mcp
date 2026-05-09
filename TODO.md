# alza-mcp — TODO

Concrete implementation checklist for **v0.1**. Items below correspond to what's actually being built in this commit.

---

## Bootstrap
- [x] `package.json` — name, bin, engines, scripts, deps
- [x] `tsconfig.json` — strict, NodeNext, ESM, outDir `dist`
- [x] `.gitignore` — node_modules, dist, .env, log files
- [x] `LICENSE` — MIT
- [x] `.npmignore` — keep published package small

## Infrastructure
- [x] `src/infra/locale.ts` — base URL → `Accept-Language` + currency mapping
- [x] `src/infra/errors.ts` — typed errors (`CloudflareChallengeError`, `UpstreamError`, `NotFoundError`)
- [x] `src/infra/cache.ts` — tiny LRU + TTL
- [x] `src/infra/alza-client.ts` — CF-aware fetch:
  - [x] cookie jar (in-memory `Map<string,string>`)
  - [x] mobile-app User-Agent + headers
  - [x] handshake (`getAllDeliveryCountries` → `setCountry`), cached ~30 min
  - [x] min 100 ms spacing between requests
  - [x] retry 3× with jittered exponential backoff on 429/5xx/CF
  - [x] CF-challenge body detection
  - [x] `ALZA_PROXY_URL` hook
  - [x] structured logging to stderr
- [x] `src/infra/jsonld.ts` — fetch a product page, extract `<script type="application/ld+json">`, parse `Product`/`Offer`/`AggregateRating`

## Domain
- [x] `src/domain/catalog.ts` — `searchProducts`, `getProduct`, `listCategories`
- [x] `src/domain/reviews.ts` — `getProductReviews` via JSON-LD
- [x] `src/domain/pickup.ts` — `findPickupPoints` (AlzaBox API + static branches)
- [x] `src/data/branches.json` — seeded list of major Alza branches

## MCP surface
- [x] `src/tools/search-products.ts`
- [x] `src/tools/get-product.ts`
- [x] `src/tools/get-product-reviews.ts`
- [x] `src/tools/find-pickup-points.ts`
- [x] `src/tools/list-categories.ts`
- [x] `src/resources/product.ts` — `alza://product/{code}`
- [x] `src/prompts/find-product.ts` — guided shopping prompt

## Server wiring
- [x] `src/server.ts` — buildServer() that registers all tools/resources/prompts (testable)
- [x] `src/index.ts` — shebang, stdio transport, error handling

## Tests
- [x] `test/fixtures/` — sample REST + JSON-LD payloads
- [x] `test/catalog.test.ts` — normalization
- [x] `test/locale.test.ts` — base URL mapping
- [x] `test/cache.test.ts` — TTL semantics
- [x] `test/jsonld.test.ts` — schema.org parsing
- [x] `scripts/validate-api.ts` — hits real upstream, prints pass/fail report

## CI & polish
- [x] `.github/workflows/ci.yml` — lint, typecheck, test, build
- [x] `README.md` — install, tools table, how-it-works, disclaimer, roadmap
- [x] `CONTRIBUTING.md`
- [x] `CHANGELOG.md`
- [x] `.github/ISSUE_TEMPLATE/` — bug + endpoint-broken templates

## Verify
- [x] `npm install`
- [x] `npm run build`
- [x] `npm test`
- [x] `node dist/index.js` — sanity (stdio waits for input)

---

## Future (roadmap, out of scope for v0.1)

- [ ] Streamable HTTP transport on Vercel (`mcp-handler`)
- [ ] Vercel Runtime Cache + Cron for daily `validate-api`
- [ ] Price watchlist (Upstash Redis + cron)
- [ ] PC builder (compatibility engine over `params`)
- [ ] Compare / recommend / deals tools
- [ ] Write actions (cart/order) via MCP URL elicitation
- [ ] Registry submissions (Smithery, mcp.so, PulseMCP, official servers list)
