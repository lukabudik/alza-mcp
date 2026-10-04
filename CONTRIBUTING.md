# Contributing to alza-mcp

Thanks for considering a contribution. This is a small, focused project — an MCP server for Alza.cz covering the catalog plus token-guarded account/checkout tools — and the bar for any change is "does it make agents better at helping people shop?".

Looking for something to work on? See [ROADMAP.md](ROADMAP.md) and the [`good first issue`](https://github.com/lukabudik/alza-mcp/labels/good%20first%20issue) label. Comment on an issue before starting so work isn't duplicated.

## Quick start

```bash
git clone https://github.com/lukabudik/alza-mcp.git
cd alza-mcp
npm install
npm test          # unit tests
npm run typecheck # TS strict
npm run build     # compile to dist/
npm run validate:api  # hits real Alza endpoints — internet required
```

## Project layout

```
src/
  index.ts          # stdio entrypoint
  server.ts         # builds the McpServer; testable
  infra/            # HTTP client, locale, JSON-LD, cache, errors, logger
  domain/           # catalog / reviews / pickup
  tools/            # one file per MCP tool
  resources/        # alza:// resource handlers
  prompts/          # MCP prompt templates
  data/             # static datasets (e.g. branches)
test/               # vitest tests + fixtures
scripts/            # validate-api & ops scripts
```

## Adding a new tool

1. Create `src/tools/your-tool.ts` exporting `createYourTool(deps): RegisterableTool`. Its `register()` must **return** the SDK's `RegisteredTool` handle (`return server.registerTool(...)`) — toolsets use it to enable/disable the tool.
2. Define a Zod input schema. **Every field gets `.describe()`** — that text is what the LLM reads to decide whether and how to call the tool.
3. Set `annotations.readOnlyHint: true` for read-only tools. Anything that mutates must set `readOnlyHint: false`; anything irreversible or money-relevant must also set `destructiveHint: true` and be gated by a one-time token (`prepare_mutation` → `confirmation_token` argument, see `web_place_order`/`cancel_order`).
4. Return both `content[].text` (Markdown summary for chat) and `structuredContent` (typed JSON for the agent), and add an entry to `OUTPUT_SCHEMAS` in `src/tools/output-schemas.ts`.
5. Register the tool in `src/server.ts` **and assign it to exactly one toolset** in `src/tools/toolsets.ts`. Startup throws if a registered tool isn't in a toolset (or is in two), so a new tool can never be silently unreachable.
6. Add tests: update the tool counts in `test/tool-annotations.test.ts`, `test/output-schemas.test.ts` and `test/toolsets.test.ts`, add any new mutating/destructive/no-network tool to the sets in `tool-annotations.test.ts`, update `scripts/eval.ts`'s `CANONICAL_ORDER` and counts, and add a behavioural test for the tool's logic in `test/`.
7. For anything touching a live Alza route, record it in `docs/mobile-endpoint-coverage.md` with a verification label (`source-confirmed` / `live-verified` / `blocked` / `unresolved`) and update `CHANGELOG.md`.

## Adding a data source

Add a domain module under `src/domain/`. If it talks to a new upstream:

- Prefer an official API with a documented schema (see how `pickup.ts` uses the AlzaBox OpenAPI).
- If you have to reverse-engineer, document the recipe in a top-of-file comment and reference any prior art.
- Always plumb errors through the typed errors in `src/infra/errors.ts` so the server can return clean MCP errors.

## Style

- TypeScript strict, no `any`, no `// @ts-ignore` without a comment explaining why.
- Small files, single responsibility.
- No comments that just restate the code.
- Tests are vitest; integration script is `npm run validate:api`.

## Reporting upstream breakage

When Alza changes an endpoint shape:

1. Run `npm run validate:api` and paste the output.
2. Open an "Endpoint broken" issue.
3. Bonus: include a HAR file or a curl snippet showing the new shape.

## Code of conduct

Be kind. This is a hobby project run by volunteers.
