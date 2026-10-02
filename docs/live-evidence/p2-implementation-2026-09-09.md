# P2 candidates implemented as typed tools — 2026-09-09 (goal `mttr8nno-hwczyh`, task-4)

The gap-analysis **P2 candidate table** named four candidates. This record closes
them: two got typed tool surface (chatbot family, `GetZipCodes` WCF twin), and two
turned out to need **no new API surface** (2026.17 dynamic-action follow-ups,
bank-app channel) — with the explicit scan evidence below.

## 1. Chatbot family (`chatbotapi.alza.cz`, row W18) — implemented

**New typed tools:** `alza_chat_navigation` (read) + `alza_chat_send`
(session-scoped conversational write; visitor-keyed, no account state, token-free
like `alza_web_add_to_cart`). Infra: `MobileApi.chatNavigation/chatSend`
(cross-host absolute URLs bypass the mobile base URL); domain validation in
`MobileAccount` (`page_type` 1–30 with the captured codes, 2-letter country,
length-capped strings, `list_category_id` → `{categoryId, categoryTypeId}` wire
mapping).

Live shape corrections found while probing (raw capture:
`p2-probe-2026-09-09.json`, `p2-probe2-2026-09-09.json`):

- `/v1/navigation` **requires a `country` query field** — bare → HTTP 400
  `{"errors":{"Country":["The Country field is required."]}}`; `?country=CZ` → 200
  with the server-provided action set (`chatbotInitializeChatAction`,
  `chatbotReinitializeChatAction`, `chatbotMetadataAction`, `chatbotSetRatingAction`,
  `chatbotSetParametersAction`, `chatbotPrivacyPolicy`,
  `chatbotGetConversationsAction`, `sendFeedbackAction`,
  `commodityCodesCarouselAction`).
- `/v1/chat` POST **requires `ListCategoryId` in the body** — HTTP 400 without it;
  an **empty array works without product context**. Success → 200
  `{configuration {configId: 131, teamName: "Asistentka Alzee", welcomeText:
  "Jak Vám mohu pomoci?", sessionExist: false, pageType: "productDetail", …},
  showChat: true}`.
- pageType codes per the capture: **1=product detail, 5=Order1, 6=Order2, 24=Order4**
  (the tool description documents these; `chatSend` accepts 1–30).

## 2. WCF `GetZipCodes` twin (`EShopService.svc`) — implemented

**New whitelist op:** `alza_mobile_read {operation:"web_zip_codes", args:{input}}`.
Infra: `MobileApi.webZipCodes` → `webWcfStep("GetZipCodes", {Search: input})`.

Live shape correction (raw capture: `p2-probe-2026-09-09.json`,
`p2-probe2-2026-09-09.json`): six candidate body fields probed — only the
**PascalCase `Search` field binds** (`{input:…}`, `{Input:…}`, `{ZipCode:…}`,
`{Value:…}`, `{Text:…}`, `{Query:…}` all return the "not found" app-level
response `ErrorLevel:14`); `{Search:"Hradec Králové"}` → 200 with
`{d:{Value:"<div class=\"zip-item\" data-id=\"3022826\" data-city=\"Hradec
Králové\" data-text=\"500 00\" …>", ErrorLevel:0}}` — the response `Value` is an
**HTML snippet** of `zip-item` divs, documented as such in the tool description.

## 3. Typed-stack E2E (compiled `dist/` in the live page)

Same technique as the G4 E2E (`g4-typed-e2e-2026-09-09.md`): the compiled dist
modules bundled with esbuild and executed inside the live www.alza.cz page via
Playwright, so the real `MobileAccount` methods run where Cloudflare passes. Raw
capture: `p2-typed-e2e-2026-09-09.json`. Steps:

1. `chatNavigation()` → 200; action keys as probed; `chatbotInitializeChatAction.href`
   = `https://chatbotapi.alza.cz/api/visitors/{vid}/v1/chat?country=CZ`.
2. `chatSend({page_type:1, referrer:"https://www.alza.cz/"})` → `configId:131`,
   `teamName:"Asistentka Alzee"`, `welcomeText:"Jak Vám mohu pomoci?"`,
   `sessionExist:false`, `showChat:true`.
3. `webZipCodes("Hradec Králové")` → `ErrorLevel:0`, `Value` is the zip-item HTML,
   first entry `data-text:"500 00"`, `data-city:"Hradec Králové"`.

## 4. Candidates that need NO new API surface (explicit record)

- **2026.17 server-driven dynamic-action follow-ups (`afterSelectAction` /
  `afterDeselectAction` on D1 `Delivery`/`Payment` items):** live scan with a real
  basket (`p2-probe2-2026-09-09.json`, "D1 action scan"): **59 deliveries and 14
  payments — 0 items with a non-null `afterSelectAction`/`afterDeselectAction`;
  `alzaPlusActionBannerAction` null**. The 2026.17 response models carry the fields
  but the server never populated them in the probed state, so there is no action to
  follow: the fields stay **documented-only** in the dynamic-actions table (coverage
  doc, row D1 + dynamic-actions record). The static select path remains typed via
  `alza_select_pickup_point` + sendOrder2.
- **Bank-app payment channel (2026.17 preferred-bank-app feature):** stays
  **documented-only** as row **PA11** — the bank app is a client-side deep-link
  channel for the same `paymentId` flow; the API-level surface is unchanged
  (PA2/PA3/PA9 + PA10 QR). No new endpoint, hence no new tool.

## 5. Tests

`test/account.test.ts` — new describe block "P2 candidates implemented as typed
tools (2026-09-09)": 3 tests covering country validation + cross-host route,
`chat_send` validation + exact W18 wire body (incl. `list_category_id` mapping),
and `web_zip_codes` validation + `{Search: input}` body + `d`-envelope unwrap.
Suite: 8 files, 66 tests, all passing (2026-09-09).
