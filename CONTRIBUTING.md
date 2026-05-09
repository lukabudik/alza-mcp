# Contributing to alza-mcp

Thanks for considering a contribution. This is a small, focused project — read-only MCP wrapper for Alza.cz — and the bar for any change is "does it make agents better at helping people shop?".

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

1. Create `src/tools/your-tool.ts` exporting `createYourTool(deps): ToolDefinition`.
2. Define a Zod input schema. **Every field gets `.describe()`** — that text is what the LLM reads to decide whether and how to call the tool.
3. Set `annotations.readOnlyHint: true` for read-only tools. Anything that mutates anything must set `destructiveHint: true` and require an explicit `confirm: true` argument.
4. Return both `content[].text` (Markdown summary for chat) and `structuredContent` (typed JSON for the agent).
5. Register the tool in `src/server.ts`.
6. Add a fixture-based test in `test/`.

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
