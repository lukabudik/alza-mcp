# MCP best-practices audit — alza-mcp

Date: 2026-09-10. Scope: all 41 tools + product resource + find-product prompt + server
instructions, audited against the MCP specification and Anthropic's tool-design guidance.
Every finding is cited to a source; priorities P0 (fix first) → P3 (nice-to-have).

## Sources

| # | Guidance | URL |
|---|---|---|
| S1 | MCP spec (2025-06-18, re-fetched 2026-09-13) — Tools: tool definition (name/title/description/inputSchema/outputSchema/annotations), structured content, output schema, error handling (protocol vs tool-execution errors), security (validate inputs). **Still the wire-level normative reference for this server:** the pi gateway negotiates `protocolVersion: 2025-06-18` (docs/live-evidence, stdio captures), so what pi sees is governed by this revision's tool definition. | https://modelcontextprotocol.io/specification/2025-06-18/server/tools |
| S2 | MCP spec (draft, re-fetched 2026-09-13; page revision 2026-09-08) — Tool names (1–128 chars, allowed charset, unique per server; serverInfo `name` not guaranteed unique, SHOULD NOT be relied on for disambiguation), no-param schema recommendation, stateful-tool guidance (retention in descriptions, expiry errors), deterministic ordering for prompt caching | https://modelcontextprotocol.io/specification/draft/server/tools |
| S3 | MCP docs (2026-07-28, re-fetched 2026-09-13) — Client best practices: progressive tool discovery relies on "descriptive tool names and descriptions"; "The real fix is for server authors to provide `outputSchema`"; programmatic tool calling generates typed APIs from `outputSchema` | https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices |
| S4 | Anthropic — "Writing effective tools for AI agents" (2025-09-11, re-fetched 2026-09-13, unchanged): design tools for agents; few thoughtful tools over endpoint wrappers; overlapping/vague tools confuse agents; meaningful namespacing by service/resource; high-signal responses, avoid low-level identifiers (uuid, mime_type); pagination/filtering/truncation with sensible defaults; `response_format` concise/detailed pattern; unambiguous parameter names (`user_id` not `user`); helpful actionable error messages; "prompt-engineering your tool descriptions and specs" is one of the most effective methods | https://www.anthropic.com/engineering/writing-tools-for-agents |
| S5 | Anthropic — "Define tools" (Claude platform docs, re-fetched 2026-09-13): "Provide extremely detailed descriptions. This is by far the most important factor in tool performance" — what it does, when to use it **and when it shouldn't**, what each parameter means, caveats; aim for 3–4+ sentences; consolidate related operations into fewer tools; meaningful namespacing (e.g. `github_list_prs`); design responses to return only high-signal information; `input_examples` for complex tools (Claude-API-only field, not in the MCP tool definition) | https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools |
| S6 | MCP spec **2026-07-28** (re-fetched 2026-09-13; NEW versioned revision since the 2026-09-10 audit, which predated it) — server/tools: adds `icons` on the tool definition, `x-mcp-header` extension property, `InputRequiredResult` multi-round-trip requests, tools/list `caching` utility, `$ref` resolution requirements for input/output schema validation; SEP-2106 widened `outputSchema` to any JSON Schema 2020-12 and `structuredContent` to any JSON value conforming to it; stateful-tools guidance (authorization, opacity, lifetime in descriptions, expiry errors); deterministic ordering | https://modelcontextprotocol.io/specification/2026-07-28/server/tools |
| S7 | MCP spec index (2026-07-28, re-fetched 2026-09-13) — security & trust principles (user consent, data privacy, tool safety; tool descriptions/annotations untrusted unless from a trusted server); extensions overview: Tasks (async long-running ops), Skills over MCP, MCP Apps (interactive UI); elicitation | https://modelcontextprotocol.io/specification/ |
| S8 | MCP TypeScript SDK v2 tools docs + the SDK this repo pins (`^1.26.0` → installed 1.29.0, verified locally): `registerTool` accepts `outputSchema`; when a tool has `outputSchema`, the handler MUST return `structuredContent` conforming to it and the SDK validates the result against the schema on every call; when it does not, the handler returns `content` | https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html |

### Deltas since the 2026-09-10 audit (S-refresh, 2026-09-13)

1. **A new versioned revision exists: 2026-07-28.** The 2026-09-10 audit cited only 2025-06-18 + draft. The 2026-07-28 server/tools page is substantively the draft page (plus the same content), so the draft-era guidance is now normative-adjacent. Deltas relevant to alza-mcp: `icons` (display, optional), `x-mcp-header` (HTTP-transport-only; this server is stdio — MAY ignore), `InputRequiredResult` (multi-round-trip requests — a spec-native alternative to our bespoke confirmation-token flow, worth recording in §Follow-ups), tools/list `caching` utility, `$ref` resolution requirements, `structuredContent` widened to "any JSON value" (SEP-2106), `outputSchema` widened to any JSON Schema 2020-12.
2. **Tool-name guidance unchanged in substance** (1–128, allowed charset, unique per server); new clarification that the server's `name` is not reliable for disambiguation — supports the F-01 fix (drop the server-side `alza_` prefix; let clients prefix).
3. **S3 strengthened:** the client best-practices doc now documents progressive discovery + programmatic tool calling, which generate typed APIs from `outputSchema` — makes the per-tool `outputSchema` follow-up (F-06c) more valuable than when recorded.
4. **S5 unchanged in substance**; confirms `input_examples` remains a Claude-API field, not MCP.
5. **Installed SDK moved 1.26 → 1.29** (in-range for the `^1.26.0` pin): `outputSchema` support confirmed in `registerTool` (see S8). SDK 1.30 is current upstream; the pin is in-range but the audit should note the version.

## Inventory (41 tools)

> **Historical record — the as-found 2026-09-10 state, before the F-01…F-10
> fixes.** The `alza_` names and “raw” output columns below describe that
> snapshot; for the current surface see the wire capture in
> [Re-audit 2026-09-13](#re-audit-2026-09-13-fresh-cycle). (One row was
> inaccurate even against its own snapshot: `search_products` has carried
> `{readOnlyHint, openWorldHint}` since v0.1.0 — no `idempotentHint`; see N-2.)

Legend — Description: **A** = agent-facing (when-to-use/when-not, outcome) · **M** =
endpoint-mechanics phrasing ("Read X endpoint / POST a Y payload") · **S** = stale
(v0.1/v0.2 caveats that no longer match the implementation). Params: **d** = described,
**u** = undocumented. Annotations: R=readOnly, D=destructive, I=idempotent, O=openWorld.
Output: **md** = markdown text + structured · **raw** = raw upstream JSON (unbounded).

### Catalog (`src/tools/`)

| Tool | Desc | Params | Annotations | Output |
|---|---|---|---|---|
| `search_products` | A (exemplary: use-cases, follow-up guidance) | d (all) | R I O | md |
| `get_product` | A + **S** ("params … often empty in v0.1 — planned for v0.2") — impl scrapes `paramTbl` rows (catalog.ts:86,182) | d | R I | md |
| `get_product_reviews` | A + **S** ("v0.1 returns aggregate values only … `reviews` array will be empty") — impl scrapes individual reviews (reviews.ts:30-106) | d | R I | md |
| `find_pickup_points` | A + **S** ("AlzaBox … planned for v0.2") while schema advertises `types: ["alzabox","branch"]` but only `branch` returns data (pickup.ts:39 "AlzaBox lockers — v0.2") | d | R I O | md |
| `list_categories` | A (drill-down guidance) | d | R I | md |

### Account — auth, cart, checkout (`src/tools/account.ts`)

| Tool | Desc | Params | Annotations | Output |
|---|---|---|---|---|
| `alza_auth_discovery` | A-ish (read-only, no credentials) | — (no params) | R I | raw |
| `alza_auth_start` | A (3-step flow stated) | — | ~R I | raw |
| `alza_auth_exchange` | A (what to pass / never pass) | **u** (code, state) | ~R I | raw |
| `alza_mobile_read` | M + catch-all: 41-value operation enum + free-form `args` record | **u** (operation, args) | R I | raw |
| `alza_prepare_mutation` | **A+** (action→executor mapping, DTO examples) — exemplar | **u** (action enum values) | R, ~I | raw |
| `alza_mutate_list` | **A+** (per-action payload DTOs with dated ModelState evidence) — exemplar | **u** (action, token, payload) | ~R ~I | raw |
| `alza_account_status` | M-ish, thin | — | R I | raw |
| `alza_cart` | M ("Read basketInfo and gridOrder1") | — | R I | raw (≈20 KB) |
| `alza_add_to_cart` | M ("POST a BuyByCode-compatible payload") | **u** (code, quantity) | ~R ~I | raw |
| `alza_delivery_options` | M ("Call … getDeliveryPaymentGroups endpoint") | **u** | R I | raw |
| `alza_select_pickup_point` | M ("POST … DeliveryPaymentAssociation payload") | **u** (association) | ~R ~I | raw |
| `alza_checkout_preview` | M, but states non-submission + token | **u** | R ~I | raw |
| `alza_place_order` | M, but states prerequisites + token | **u** (4 payloads) | ~R ~I | raw |
| `alza_web_pickup_places` | **A+** (fields returned, read-only, follow-up tool) | d (partial) | R I | raw |
| `alza_web_add_to_cart` | **A+** (visitor-keyed basket, follow-up, mutating note) | d | ~R ~I | raw |
| `alza_web_cart` | A-ish (HATEOAS cart state + item fields listed, cross-ref to `alza_web_add_to_cart`, read-only) | d | R I | raw |
| `alza_chat_navigation` | A-ish (row W18, read-only) | d | R I | raw |
| `alza_chat_send` | A-ish (page_type codes with dated capture) | d (partial) | ~R ~I | raw |

### Account — profile, orders, payments, subscriptions (`src/tools/advanced.ts`)

| Tool | Desc | Params | Annotations | Output |
|---|---|---|---|---|
| `alza_profile` | A-ish (what's returned; auth prerequisite) | — | R I | raw (large) |
| `alza_contacts` | M-ish, thin | — | R I | raw |
| `alza_register` | **A+** (credential-bearing, token + confirmation) | **u** (email/phone/pwd/code) | ~R ~I | raw |
| `alza_address_upsert` | A-ish (action source + token); typed fields | **u** (most) | ~R ~I | raw |
| `alza_address_delete` | M-ish + token | **u** | ~R ~I | raw |
| `alza_address_search` | M-ish (read-only stated) | **u** | R I | raw |
| `alza_payment_methods` | A-ish (prerequisite: cart with products) | **u** | R I | raw |
| `alza_after_order_payments` | A-ish (follow-up tool named) | **u** | R I | raw |
| `alza_pay_after_order` | **A+** (money movement, token + confirmation) | **u** (most) | ~R ~I | raw |
| `alza_order` | A-ish (scope params explained in desc) | **u** (4) | R I | raw |
| `alza_review_submit` | A-ish (action source + token) | **u** (action, values) | ~R ~I | raw |
| `alza_complaint_claims` | M-ish | **u** | R I | raw |
| `alza_subscription_overview` | A-ish | **u** | R I | raw |
| `alza_subscription_activate` | A-ish (high-impact + token) | **u** | ~R ~I | raw |
| `alza_subscription_update_installment` | A-ish (high-impact + token) | **u** | ~R ~I | raw |
| `alza_upload_attachment` | **A+** (1–5 files, MIME, size limits, token) | **u** (action, files, values) | ~R ~I | raw |
| `alza_web_place_order` | **A+** (working path vs G1/G5, sources of each id, token) | d (all) | ~R ~I | raw |
| `alza_web_pay_after_order` | **A+** (recorded payment path, token) | d (most) | ~R ~I | raw |

### Prompt + resource

| Item | State |
|---|---|
| `find-product` prompt | Good guided workflow; references catalog tool names (must follow rename map) |
| `alza://product/{code}` resource | Good (JSON product); description fine |

### Server instructions (src/server.ts:52-62)

Present and useful (workflow + token rules); references old tool names; does not state
which order-submission path is currently working (web WCF chain per G1/G5).

## Findings

### F-01 · P0 · Naming convention split (36 tools)
5 catalog tools are bare (`search_products` …), 36 account tools carry an `alza_`
server-name prefix → the pi gateway surfaces `alza_search_products` vs
`alza_alza_cart` (double prefix). S2: names only need uniqueness *within a server*;
clients "MAY … prefix tool names with a server identifier" for disambiguation — so the
server-side `alza_` prefix is redundant and produces doubled names. S5: meaningful
namespacing is by *service/resource* (`github_list_prs`), not by server name.
**Fix:** drop the `alza_` prefix from all 36 tools (bare names, one convention).
Rename map in §Rename map. Update every cross-reference: server instructions, the
find-product prompt, resource description, and all description-level tool references.

### F-02 · P0 · Descriptions: endpoint-plumbing phrasing + stale caveats
36/41 tools are described as HTTP plumbing ("Read basketInfo and gridOrder1",
"POST a BuyByCode-compatible payload") without when-to-use / when-NOT-to-use, and none
of the catalog-era "v0.1/v0.2" caveats survive: `get_product` params are now scraped
(catalog.ts:86,182), `get_product_reviews` returns individual reviews (reviews.ts:30-106),
`find_pickup_points` still can't return AlzaBox (pickup.ts:39). S5: "extremely detailed
descriptions … by far the most important factor" — what it does, when to use it and when
not, each parameter's effect, caveats, 3–4+ sentences. S4: descriptions are loaded into
agent context and steer tool selection; small refinements yield dramatic improvements.
**Fix:** rewrite every tool description agent-facing (outcome → when to use → when not →
prerequisites → side effects → example where useful); remove stale v0.1/v0.2 lines.

### F-03 · P1 · Undocumented parameters
~25 parameters across account/advanced tools have no `.describe()` (e.g.
`auth_exchange.code/state`, `add_to_cart.code`, `select_pickup_point.association`,
`place_order` payloads, `mobile_read.operation/args`, `order.*`, `register.*`).
S5: "what each parameter means and how it affects the tool's behavior"; S4: unambiguous,
self-explanatory names (we're compliant on names: `user_id`-style).
**Fix:** describe every parameter (source of the value, format, example where useful).

### F-04 · P1 · Catch-all `alza_mobile_read`
41-operation enum + free-form `args: record` with a one-line description; overlaps typed
tools (`basket_info`↔`cart`, `user_data`↔`profile`, `contacts`↔`contacts`,
`search`↔`search_products`, `category`↔`list_categories`). S4: "tools that overlap in
function or have a vague purpose … agents can get confused"; each tool needs "a clear,
distinct purpose". **Fix:** reposition explicitly as the raw-API escape hatch:
description states "prefer the typed tool when one exists (list)", documents the
highest-value operations with args examples (router_product/legacy_product need
`product_id` = the `d########` from the product URL; basket_info; user_data; …).
Keep the tool — it covers ~35 operations with no typed equivalent (repo coverage docs).

### F-05 · P1 · Annotations incomplete
- `destructiveHint: true` never set explicitly on any mutating tool (S1: annotations
  describe behavior; S4: "tool annotations … disclose which tools make destructive
  changes").
- `openWorldHint` set on the 5 catalog tools but missing on all 36 account tools — every
  one of them calls alza.cz (open world).
- `idempotentHint` is broadly correct; keep.
**Fix:** explicit `destructiveHint: true` on all ~R tools, `openWorldHint: true` on all
remote tools.

### F-06 · P1 · Outputs: unbounded raw JSON, no concise channel, no outputSchema
All 36 account/advanced tools return `JSON.stringify(envelope, null, 2)` (~20 KB for
`cart`/`profile`/`router_product`) with low-signal fields (`vzt`, `serverTime`,
`user_name: ""`, `favCnt`) and no human-readable summary; catalog tools demonstrate the
better pattern (markdown + structured). No `outputSchema` anywhere (SDK 1.26 supports
it). S4: "return only high signal information … eschew low-level technical identifiers";
pagination/truncation with sensible defaults; `response_format` concise/detailed pattern.
S3: server-provided `outputSchema` enables typed programmatic tool calling.
**Fix:** (a) concise text summary (format.ts pattern) for the high-volume tools
(cart, profile, add_to_cart, order, mobile_read product ops) while keeping the full
envelope in `structuredContent`; (b) optional `detail: "concise"|"full"` parameter on
the three largest (cart, profile, mobile_read) — default concise for cart/profile;
(c) `outputSchema`: record as follow-up — upstream envelopes are dynamic (err/msg shape
stable, data shape per-operation), schema per tool is disproportionate; document in §Follow-ups.
**Errors:** Zod validation failures dump the whole schema (e.g. the 41-value operation
enum); S4/S5: actionable, specific errors. **Fix:** trim validation errors to the
offending field + expected value + one example.

### F-07 · P2 · Stale package/README descriptions
`package.json` description: "read-only interface to browse products, reviews, and
pickup points" — the server now exposes 36 authenticated account/checkout tools.
**Fix:** update `package.json` description + README "What it does" section to match.

### F-08 · P2 · Schema/behavior mismatches
1. `find_pickup_points` advertises `types: ["alzabox","branch"]` but only `branch` can
   return data (pickup.ts:39). S4: "avoid ambiguity by clearly describing (and
   enforcing with strict data models) expected inputs and outputs". **Fix:** description
   states `alzabox` currently returns no results (documented, not yet implemented); keep
   the enum value so the surface is stable when AlzaBox support lands (no new API
   surface now).
2. `prepare_mutation`'s action Zod enum (27 values) omits `web_place_order` and
   `web_after_order_payment`, which the tool's own description and the domain's
   `MUTATION_ACTIONS` (mobile-account.ts:6-17) both require — calling
   `prepare_mutation({action:"web_place_order"})` fails Zod validation today. **Fix:**
   add both values to the enum (29 actions).

### F-09 · P3 · Empty inputSchema
4 no-param tools pass `inputSchema: {}`. S2 (draft): prefer
`{ type: "object", additionalProperties: false }`. SDK-dependent; low risk. **Fix:**
apply if the SDK accepts it; otherwise record as SDK limitation.

### F-10 · P3 · Deterministic ordering (no action)
Tools register in fixed array order (S2: deterministic ordering enables client caching)
— already compliant.

## Consolidation analysis (task-4 input)

| Pair(s) | Verdict |
|---|---|
| `cart`/`add_to_cart`/`place_order`/`pay_after_order` vs `web_*` counterparts | **Keep both.** Different API stacks *and* contexts: mobile REST (authenticated account, OAuth) vs legacy web WCF (visitor basket, `Balancer-Guid`). The web WCF chain is the *working* order-submission path while mobile `sendOrder3` 500s (docs/gap-analysis.md G1/G5; `web_place_order` description already says so). Not overlapping functionality — different data domains. Description-level cross-references are the fix. |
| `mobile_read` vs typed tools | **Keep as escape hatch** (F-04): ~35 operations have no typed tool; disambiguate via description, not removal. |
| `chat_navigation` + `chat_send` | **Keep:** distinct purpose (chatbot W18 family), no typed equivalent. |
| `after_order_payments` vs `mobile_read(operation=web_after_payment_dialog)` | **Keep both:** typed (mobile API) vs raw (web dialog) — different payment id domains; cross-referenced in descriptions. |

**Result: no tool consolidations justified** — the surface is domain-distinct; the fix
is naming consistency + descriptions (F-01…F-04). Recorded per the goal's success
criterion ("or the audit explicitly records 'none justified'").

## Already good (do not regress)

- Catalog tools: agent-facing descriptions, per-parameter descriptions, examples,
  markdown + structured output, correct annotations.
- `prepare_mutation` / `mutate_list` / `web_place_order` / `web_pay_after_order`:
  exemplary DTO-level payload documentation with dated evidence.
- One-time confirmation-token flow for all high-impact mutations (client-side
  confirmation, per S1 security: "Prompt for user confirmation on sensitive operations").
- `title` on every tool (S1: human-readable display name).
- Zod input validation with meaningful bounds (S1: "Validate all tool inputs").
- structuredContent + TextContent on all tools (S1 backwards-compat rule).
- Server instructions, one resource, one guided prompt.
- Fixed registration order (F-10).

## Rename map (F-01)

| Old | New |
|---|---|
| `alza_auth_discovery` | `auth_discovery` |
| `alza_auth_start` | `auth_start` |
| `alza_auth_exchange` | `auth_exchange` |
| `alza_mobile_read` | `mobile_read` |
| `alza_prepare_mutation` | `prepare_mutation` |
| `alza_mutate_list` | `mutate_list` |
| `alza_account_status` | `account_status` |
| `alza_cart` | `cart` |
| `alza_add_to_cart` | `add_to_cart` |
| `alza_delivery_options` | `delivery_options` |
| `alza_select_pickup_point` | `select_pickup_point` |
| `alza_checkout_preview` | `checkout_preview` |
| `alza_place_order` | `place_order` |
| `alza_web_pickup_places` | `web_pickup_places` |
| `alza_web_add_to_cart` | `web_add_to_cart` |
| `alza_web_cart` | `web_cart` |
| `alza_chat_navigation` | `chat_navigation` |
| `alza_chat_send` | `chat_send` |
| `alza_profile` | `profile` |
| `alza_contacts` | `contacts` |
| `alza_register` | `register` |
| `alza_address_upsert` | `address_upsert` |
| `alza_address_delete` | `address_delete` |
| `alza_address_search` | `address_search` |
| `alza_payment_methods` | `payment_methods` |
| `alza_after_order_payments` | `after_order_payments` |
| `alza_pay_after_order` | `pay_after_order` |
| `alza_web_pay_after_order` | `web_pay_after_order` |
| `alza_order` | `order` |
| `alza_review_submit` | `review_submit` |
| `alza_complaint_claims` | `complaint_claims` |
| `alza_subscription_overview` | `subscription_overview` |
| `alza_subscription_activate` | `subscription_activate` |
| `alza_subscription_update_installment` | `subscription_update_installment` |
| `alza_upload_attachment` | `upload_attachment` |
| `alza_web_place_order` | `web_place_order` |

Unchanged: `search_products`, `get_product`, `get_product_reviews`,
`find_pickup_points`, `list_categories`.

## Follow-ups (out of scope for the 2026-09-10 goal, recorded)

- `outputSchema` per tool (F-06c) — disproportionate while envelopes are dynamic;
  implemented in the 2026-09-13 cycle at envelope level (see re-audit N-1).
- AlzaBox pickup discovery (pickup.ts "v0.2") — new API surface, separate goal.
- `input_examples` (S5) — Claude-platform-specific field, not in the MCP tool
  definition; keep examples inside descriptions instead.
- Agent-driven eval harness — implemented in the 2026-09-13 cycle (`npm run eval`).

## Re-audit 2026-09-13 (fresh cycle)

### Method

- Sources S1–S5 re-fetched 2026-09-13 (unchanged); S6–S8 added (the 2026-07-28
  spec revision, spec index, TS-SDK v2 docs) — see the Sources table.
- Full `tools/list` captured over stdio against the built server
  (`docs/live-evidence/tools-list-2026-09-13.json`): names, titles, descriptions,
  inputSchemas and annotations as actually served on the wire.
- All 41 tools, the server instructions, the `find-product` prompt and the
  `alza://product/{code}` resource re-read against the refreshed sources.

### F-01…F-10 regression (all re-checked individually)

| Finding | Verdict | Evidence |
|---|---|---|
| F-01 naming split | **Fixed, still holding** | wire capture: all 41 names bare, no `alza_` prefix |
| F-02 plumbing phrasing | **Fixed** in all 41 tool descriptions; residue: 2 stale "v0.2" JSDoc comments in `src/domain/pickup.ts` (→ N-3, comments only) | source read |
| F-03 undocumented params | **Fixed, still holding** | wire capture: 0 undescribed properties across 41 tools |
| F-04 `mobile_read` catch-all | **Fixed**: repositioned as read-only escape hatch, typed-tool preference list, named high-value operations | source read |
| F-05 annotations | **Fixed** overall: `readOnlyHint` on 23 reads; `destructiveHint: true` only on the 8 genuinely destructive ops (place/web_place_order, register, address_delete, pay/web_pay_after_order, subscription_activate, subscription_update_installment); `mutate_list` D=false is correct — only the 18 whitelisted low-risk actions run through it; `account_status`/`prepare_mutation` O=false is correct (no network call); `checkout_preview` I=false is honest (mints a one-time token). Two nits → N-2 | wire capture matrix |
| F-06 outputs | **Fixed** for the 5 high-volume tools (cart, add_to_cart, checkout_preview, profile, order): concise text + full envelope in `structuredContent`. F-06c outputSchema still open → N-1 (implemented this cycle, task-5) | source read |
| F-07 stale package/README | **Fixed** | package.json:5, README "What it does" |
| F-08 schema/behavior | **Fixed**: find_pickup_points states the AlzaBox caveat honestly; prepare_mutation enum covers all 29 MUTATION_ACTIONS (18 low + 11 high incl. web_place_order/web_after_order_payment) | source read |
| F-09 empty inputSchema | **Fixed at the wire level**: sources pass `{}`, the SDK serializes `{$schema, "type":"object", "properties":{}}` — 0 empty schemas on the wire | wire capture |
| F-10 deterministic order | **Fixed**: fixed array in `src/server.ts:73-77` | source read |

Also re-verified the "Already good" list above is intact (token confirmation
flow validates the action-bound single-use token on every call via
`assertMutationToken`, mobile-account.ts:244; titles on all tools; Zod bounds;
structuredContent + TextContent everywhere; instructions/prompt/resource
reference the bare names — no stale `alza_` cross-references).

### New findings (N-series)

- **N-1 · P1 · No per-tool outputSchema** (resolution: implemented this cycle).
  The 2026-07-28 spec (S6) allows outputSchema → any JSON Schema 2020-12 schema
  and structuredContent → any JSON value; the TS SDK 1.29 `registerTool` accepts
  `outputSchema` and validates each call's `structuredContent` against it.
  Resolution: envelope-level `outputSchema` on the raw tools describing the
  stable `{err?, msg?, data}` shape (with `additionalProperties: true` for the
  operation-specific top-level keys the envelopes carry, e.g. `basket`), and
  typed schemas where the shape is fixed — `auth_discovery` (raw OIDC discovery
  document), `auth_start`, `prepare_mutation`, `account_status`,
  `checkout_preview`, `web_pickup_places`, and the 5 catalog tools. Per-operation
  data shapes stay dynamic (recorded justification, same reasoning as the
  2026-09-10 F-06c note). Status:
  **source-confirmed + live-verified** after task-5.
- **N-2 · P3 · Catalog annotation nits** (resolution: implemented this cycle).
  `search_products` lacks `idempotentHint`; `get_product`, `get_product_reviews`
  and `list_categories` lack `openWorldHint`. The 2026-09-10 inventory recorded
  search_products as "R I O" — inaccurate; corrected by this audit. Fix:
  harmonize all 5 catalog tools to R+I+O. Status: **source-confirmed + live-verified**.
- **N-3 · P3 · Stale "v0.2" JSDoc comments** in `src/domain/pickup.ts` (2 sites).
  v0.3.0 shipped without AlzaBox discovery; the comments still read "planned
  for v0.2". Comments only, no behavior. Resolution: reworded.
  Status: **source-confirmed**.
- **N-4 · P3 · 2026-07-28 spec deltas not applicable to this build** (recorded
  justification, no code change):
  - `icons` / `x-mcp-header` — HTTP-transport features; this server is stdio
    (and the SDK 1.29 registerTool has no icons param). The spec itself says a
    stdio server MAY ignore x-mcp-header.
  - `InputRequiredResult` multi-round-trip — our confirmation flow already
    achieves the same safety with a single token round-trip (prepare_mutation →
    typed mutation); restructuring to input-required results is SDK-dependent.
  - tools/list caching — SDK-managed; the gateway/pack decides. No change.
  - `$ref` resolution in schemas — our schemas are flat/inlined (Zod → JSON
    Schema via zod-to-json-schema); no `$ref` emitted, so nothing to resolve.
  - SEP-2106 (outputSchema/structuredContent broadening) — satisfied by N-1.
  - Stateful-tools auth guidance (validate caller auth against the handle on
    every call) — satisfied: the action-bound token is re-validated on every
    mutation (`assertMutationToken`), tokens auto-load from ~/.alza-mcp/tokens.json.
  Status: **source-confirmed**; re-evaluate on any HTTP transport or SDK upgrade.

### 2026-09-13 cycle outcome summary

- 0 P0/P1 regressions; F-01…F-10 all still holding (F-09 verified at wire
  level this cycle).
- New findings N-1…N-4 all resolved within this cycle (N-4 by recorded
  justification).
- Follow-ups delivered: per-tool envelope-level outputSchema (N-1), eval
  harness (`npm run eval`, `docs/live-evidence/eval-2026-09-13.json`),
  catalog annotation harmonization (N-2), N-3 rewording.
- Evaluation harness (S4) — agent-driven tool-use evals, separate goal.
- End-to-end pi-level verification (task-6): 3 headless `pi --mode json --print` runs, all PASS — catalog search (with the price-asc sort observable at the pi level), authenticated account stack (`account_status` authenticated=true + `cart` 0 items), and the two-step mutation token flow (`prepare_mutation` address_delete, token minted, no delete executed). Evidence: `docs/live-evidence/headless-pi-2026-09-13.json`.

### Eval harness (implemented this cycle) — scripts/eval.ts, `npm run eval`

- In-memory-transport harness (same registration path as stdio): 6 scenarios
  (registration-surface, catalog-read, auth-discovery, account-status,
  account-read, input-validation-error-quality); per-check `observed` values
  recorded; result file `docs/live-evidence/eval-2026-09-13.json` (6/6 passed,
  generated 2026-09-13). Non-mutating by construction — no cart/order
  mutations are executed by the harness.
- The in-memory Client (SDK 1.29) sends `LATEST_PROTOCOL_VERSION`
  **2025-11-25** and the harness handshake negotiated it — a post-2025-06-18
  revision the SDK ships. pi's gateway negotiates 2025-06-18, so S1 stays the
  wire-level normative reference for what pi sees; the eval harness's own
  negotiation is recorded in its evidence file.
- Environment observations (2026-09-13, recorded for future evals):
  - Unauthenticated mobile-API reads are **blocked from this host** with
    `HTTP 403` + an HTML body (`o3_info`, `delivery_countries`, `zip_codes`,
    `search` all reproduced it via direct fetch); authenticated calls with the
    loaded token pass (`user_data` err 0). The identity discovery endpoint
    (`identity.alza.cz/.well-known/openid-configuration`) is also 403-blocked
    from this host, so the harness treats a blocked upstream as a recorded
    graceful-error check instead of a failure.
  - `home_categories` requires the server-side `pgri`/`ui` query values —
    HTTP 400 (`null` body) without them (observed with a valid token);
    200 with `?pgri=p__…&ui=u__…` (docs/live-evidence/gap-fix-probe-
    2026-09-09.json). Documented in the `mobile_read` description this cycle.
  - Catalog reads (browser-scrape path) and the authenticated account stack
    (token path) are live-verified by the harness on 2026-09-13.
- Harness notes: the SDK 1.29 `Client` exposes no protocolVersion getter — the
  negotiated version is captured via `transport.setProtocolVersion` after
  initialize. Each call opens a fresh linked pair (SDK `Client` is single-use
  across reconnects).

### Headless pi verification (task-6, 2026-09-13) — docs/live-evidence/headless-pi-2026-09-13.json

- 3 scripted headless pi runs (`pi --mode json --print --no-session --thinking minimal`),
  all exit 0 and PASS; full tool chains, result excerpts and final answers are
  recorded in the evidence file.
- run-1 catalog search: pi surfaced `alza_search_products` via its meta-tool
  search, called it with `{query:"kabel hdmi", sort:"price-asc", in_stock:true,
  max_price:300, limit:5}`; the result came back price-ascending (99, 109, …) —
  the client-side sort fix (5ec2527) is observable at the pi level.
- run-2 authenticated account stack: `alza_account_status` → authenticated
  true, then `alza_cart` → 0 items, total 0 CZK (honest empty-cart report).
  The token-verified path works through pi's stdio transport.
- run-3 mutation token flow: `alza_prepare_mutation {action:"address_delete"}`
  → one-time token bound to the action; no delete executed. The two-step
  design survived the agent round-trip unchanged.
- Environment note: model generation on the local proxy is slow at times —
  two attempts of run-2 were cut at 420 s/720 s AFTER both MCP calls had
  already succeeded (isError false); only the final answer was truncated.
  Recorded so future runs budget accordingly.

### Search-quality follow-up (2026-09-14) — docs/live-evidence/search-quality-2026-09-14.json

Folded in and committed the same day the headless verification surfaced it:
- price/rating sorts sweep up to 3 REAL result pages by following Alza's
  rendered pagination anchors (`search.htm?pg=N` is ignored server-side; the
  rendered `-pN.htm` links serve distinct products), dedup by code, sort
  client-side; `candidatesScanned` reports the scanned count (68 candidates
  for limit 50, live).
- `in_stock` derives from the card's purchase CTA (nbsp-normalized; the
  ubiquitous 'Hlídat dostupnost nebo cenu' link must not count).
- explicit `page` follows rendered pagination; pages beyond the rendered set
  return no results instead of repeating page 1; the sweep always scans from
  page 1.
- cold-start render race: bounded 3-attempt extraction retry so a slow first
  render doesn't report a false "No products found".
Live matrix of 5 probe cases and the gate (102/102, typecheck, build,
diff-check) are recorded in the evidence file. The tool-level contract
(schema shape, annotations, outputSchema) is unchanged by this batch — only
behavioral honesty and descriptions moved.

### F-11 · P1 · Progressive tool disclosure added (2026-09-27)

- **The gap:** by 2026-09-27 the server had grown to 53 tools, all registered
  and listed simultaneously on every `tools/list` call — every prior audit
  cycle here focused on per-tool quality (naming, descriptions, annotations,
  outputSchema) but never addressed the *aggregate* count. This runs against
  S3/S4/S5's shared theme (progressive discovery, "few thoughtful tools",
  avoid overwhelming the agent's context) once a server's tool count grows
  this large — 53 tool definitions is a meaningful chunk of context before
  the agent has done anything.
- **Fix:** `src/tools/toolsets.ts` groups all 53 tools into 8 toolsets
  (`catalog`, `auth`, `basket_and_checkout`, `account_management`,
  `orders_and_payments`, `reviews_and_subscriptions`, `chat`,
  `advanced_raw`); only `catalog` + `auth` (10 tools) are enabled by default.
  Two new meta-tools, always enabled: `list_toolsets` (read-only, shows every
  group + member tools + enabled state) and `set_toolset` (enables/disables a
  whole group, or `all`, via the SDK's `RegisteredTool.enable()`/`.disable()`
  — which fires the spec-native `notifications/tools/list_changed`). No
  functionality is removed; every tool is still registered and reachable
  once its toolset is enabled — `registerToolsets` asserts at startup that
  every registered tool name is assigned to exactly one toolset, so a future
  tool addition can never be silently unreachable.
  Every `RegisterableTool.register()` now returns the SDK's `RegisteredTool`
  handle (previously discarded) so `registerToolsets` can manage enable
  state — a mechanical signature change across all 53 registration call
  sites, verified by `npm run typecheck`.
- **Test coverage:** `test/toolsets.test.ts` (6 tests) — every tool assigned
  to exactly one group, the default-enabled view is exactly the expected 12
  tools (10 domain + 2 meta), `set_toolset` enabling/disabling works and is
  observable via a real `listTools()` + `callTool()` round trip, `all` toggles
  everything, and an unknown toolset id is rejected. The three existing
  full-inventory tests (`tool-annotations.test.ts`, `output-schemas.test.ts`)
  now call `set_toolset({id:"all", enabled:true})` before asserting counts;
  their expected tool count moved from 53 to 55 (53 domain + 2 meta).
  `scripts/eval.ts`'s `registration-surface` scenario and `CANONICAL_ORDER`
  were fixed the same way, and its `CANONICAL_ORDER`/tool-count constants —
  found already stale (missing 11 tool names, counts left over from a much
  earlier tool total) independent of this change — were corrected too.
- **Live-verified:** `npm run eval` registration-surface scenario passes
  against the real server (`docs/live-evidence/eval-2026-09-26.json`).
