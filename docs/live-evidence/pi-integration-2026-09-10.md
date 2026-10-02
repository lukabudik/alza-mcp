# pi integration — 2026-09-10 (live MCP verification)

Goal: register the local repo build of this server in this pi agent's MCP config and
prove catalog discovery + the mobile account-cart stack end to end through **real MCP
tool calls** on the pi gateway (not just direct Node probes).

Raw captures: [`pi-integration-2026-09-10.json`](pi-integration-2026-09-10.json)
(sections: capture, registration, gateway, discovery, transportFallback, cartChain).

## Registration (task-1)

- `~/.pi/agent/mcp.json` gained `"alza": { "command": "node", "args": ["/home/dev/Development/alza-mcp/dist/index.js"] }`
  (global agent config, alongside `websearch`).
- Direct stdio probe of the registered command (`scripts/.pi-mcp-probe.mjs`, committed):
  initialize ok, **41 tools** listed, `alza_account_status` → `authenticated: true`
  (auth auto-loads from `~/.alza-mcp/tokens.json`; no other env required).
- Gateway listing: `mcp connect alza` → 41 tools, namespaced under the `alza_` prefix.
  Note: the gateway respawns the registered process on connect, so a freshly built
  `dist/` takes effect without `/reload`.

## Discovery flows (task-2, through the gateway)

| Call | Arguments | Result |
|---|---|---|
| `alza_search_products` | `q="čistič na kolo"`, `sort=rating`, `max_price=600` | 19 hits; top: Meguiar's Ultimate AUPR229325 (449 Kč, ★4.8), KENOTEK Moto 21697 (455, ★4.8) |
| `alza_search_products` | `q="čistič na kolo"`, `sort=price-asc`, `min_price=50`, `max_price=300`, `in_stock=true` | 10 hits (narrowing 19→10); cheapest in stock: Lotus AUPR281678 (289, ★5), BikeWorkx SPTbiwo005 (229, ★5), **SPTbiwo004 (169, ★3.5)** |
| `alza_list_categories` | — | 21 categories (root + children) |
| `alza_get_product` | `code="SPTbiwo004"` | live detail: BikeWorkx Clean Star 200 ml, InStock, 169 Kč (−5 % from 179), category Čističe |

## Account-cart chain (task-3, through the gateway)

Test account: **100000001** (`e2e-user@example.invalid`, tokens from
`~/.alza-mcp/tokens.json`).

Run 1 exposed an expiry trap: tokens minted 06:30Z (5400 s) were already stale;
`basketInfo`/`add`/profile answered **200 with anonymous envelopes (`user_id: -1`)** —
the chain "worked" but was not authenticated. Fixed by `node scripts/alza-auth-refresh.mjs`
(refresh_token rotated, obtained_at 13:55:08Z) + gateway reconnect, then:

| Step | Result |
|---|---|
| `alza_cart` (run 1) | `err:0`, basket_cnt 0, `user_id: -1`, "Jsem tak prázdný…" (anonymous — stale token) |
| `alza_add_to_cart` `{code:"SPTbiwo004", quantity:1}` (run 2) | **`err:0`, basket_cnt 3, `user_id: 100000001`**, orderItemId 1024721313, 169 Kč, "Zlevněno -5 %" |
| `alza_cart` (run 2) | basketInfo binds to **user_id 100000001 + test email**; lines: 1× SPTbiwo004 (this run's probe) + pre-existing sweep leftovers (1× HRAif8315 Pexeso 119 Kč, 2× FKP0383232 book 70 Kč) |
| `alza_prepare_mutation` `{action:"coupon_add"}` | ok, one-time `confirmationToken` `a1ebc88b3585ab4e…` |
| `alza_mutate_list` `{action:"coupon_add", coupon:"PI-INTEGRATION-PROBE-2026-09-10"}` | HTTP 200, **`err:1` "Zadaný slevový / dárkový poukaz není platný."**, `user_id: 100000001`, basket unchanged — the bogus code is rejected server-side; no discount applied |

## Transport hardening (repo change)

All `/services/restservice.svc/*` routes 403'd through the server's account stack
(plain Node fetch → Cloudflare challenge HTML with the `var getData` signature; curl
confirmed on both `www.alza.cz` and `webapi.alza.cz`). The catalog stack was already
browser-backed, so `src/infra/mobile-api.ts` gained the same structural browser
dependency and `fetchViaBrowser()`: same-origin challenge 403s are retried via an
in-page `fetch` with `credentials: include` (cold pages navigate to the base origin
first — `about:blank` cannot fetch cross-origin; one challenge-retry after a second
navigation). `src/server.ts` wires the existing browser. Cross-host routes and JSON
403s are untouched. Tests: 4 new cases in `test/account.test.ts`; suite **70/70**,
typecheck + build clean.

## Leftovers (honest note)

The probe item (1× BikeWorkx Clean Star 200 ml, 169 Kč) remains in the test account
cart together with the pre-existing sweep leftovers — the MCP exposes no
basket-item-remove operation (row B4 is the delayed-payment flag update only), so
removal is out of scope by the goal constraints. No real discount code was ever
applied; the coupon round-trip used a clearly bogus code.
