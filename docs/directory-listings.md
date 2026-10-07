# Directory listings: ready-to-paste submission text

Status as of 2026-10-06. Nothing below has been submitted; every submission needs the repository owner (@lukabudik) because directories verify ownership or require an account. This file only prepares the text so each listing says the same true things.

Every listing must state:

- **Unofficial.** Not affiliated with, endorsed by, or sponsored by Alza.cz a.s.
- **Alza.cz plus CEE locales** (cz, sk, hu, at, de, co.uk via `ALZA_BASE_URL`).
- **Account, cart and checkout tools are off by default** (only the `catalog` and `auth` toolsets start enabled; the rest are enabled with `set_toolset`), and every high-impact mutation (order placement, cancellation, password/e-mail/phone change, account deletion) needs a one-time confirmation token from `prepare_mutation`.

Shared facts: package `alza-mcp-community` on npm (`npx -y alza-mcp-community`), repository https://github.com/lukabudik/alza-mcp-community, licence MIT, transport stdio, registry name `io.github.lukabudik/alza-mcp-community`. First tool call downloads a headless Chromium (about 92 MB, about 30 s). No environment variable or secret is needed for the default install.

## Short description (use where a one-liner is asked)

> Unofficial MCP server for Alza.cz (CZ, SK, HU, AT, DE, UK): product search, details, reviews and pickup points. Account, cart and checkout tools are off by default and token-guarded.

## Long description

> alza-mcp-community is an unofficial Model Context Protocol server for Alza.cz, Central Europe's largest e-commerce store. It is not affiliated with, endorsed by, or sponsored by Alza.cz a.s. It lets an agent search products (with price, rating and attribute filters), read full product detail and reviews, and find pickup points and AlzaBox locations, across the Czech store and the CEE locales (SK, HU, AT, DE, UK) selected with one environment variable.
>
> Safety model: only the read-only catalog tools and the auth tools are enabled at start. Account, cart, delivery, checkout and order tools are registered but disabled until the user enables their toolset, and every high-impact action (placing or cancelling an order, changing password, e-mail or phone, deleting the account) requires a one-time confirmation token issued by `prepare_mutation`. The server never receives or stores the Alza password. See the README disclaimer: this is a reverse-engineered client and acts on real accounts when those toolsets are enabled.
>
> Install: `npx -y alza-mcp-community` (Node 20+). No API key needed.

Tags/categories: shopping, e-commerce, search, czech, europe.

## Smithery (https://smithery.ai)

- Uses the repository's `smithery.yaml` (stdio, `npx -y alza-mcp-community`). `configSchema` was checked against the README "Configuration" table on 2026-10-06 and now exposes `ALZA_BASE_URL`, `ALZA_CDP_URL`, `ALZA_HEADLESS`, `ALZA_IDLE_TTL_MS`, `ALZA_PROXY_URL` and `ALZA_DEBUG`. Auth/OAuth variables are deliberately not exposed (secrets stay local).
- Steps for the owner: sign in with GitHub, "Add server", pick `lukabudik/alza-mcp-community`, confirm it picks up `smithery.yaml`, paste the long description above.
- Display name: `Alza.cz (unofficial)`.

## Glama (https://glama.ai/mcp/servers)

- Glama indexes GitHub repositories automatically; the owner claims the listing ("Claim ownership" after GitHub sign-in) and runs its automated checks (it builds the server and introspects tools). Note: the repository has no Dockerfile; Glama can build from the npm package, but if its check fails for want of a build recipe, add the `npx -y alza-mcp-community` command in the claim form.
- Paste the long description into the listing's description field.

## PulseMCP (https://www.pulsemcp.com/submit)

- Submit type "MCP server", URL `https://github.com/lukabudik/alza-mcp-community`. PulseMCP also ingests the official MCP Registry, so the listing may appear on its own after the first release that publishes `io.github.lukabudik/alza-mcp-community` (see issue #19); submit manually only if it has not appeared a few days after that.
- Paste the short description in the summary field.

## mcp.so (https://mcp.so/submit)

- Fields: Type `MCP Server`, Name `Alza.cz (unofficial)`, URL `https://github.com/lukabudik/alza-mcp-community`.
- Server config to paste:

```json
{
  "mcpServers": {
    "alza": {
      "command": "npx",
      "args": ["-y", "alza-mcp-community"]
    }
  }
}
```

- Paste the long description.

## awesome-mcp-servers (https://github.com/punkpeye/awesome-mcp-servers)

Read that repository's CONTRIBUTING for the current rules (alphabetical order, one line per entry, emoji legend, glama badge requirement) before opening the PR. Section: "Shopping and e-commerce" (or the closest "E-commerce" / "Shopping" heading present at submission time). Suggested entry, to be adjusted to the list's legend:

```markdown
- [lukabudik/alza-mcp-community](https://github.com/lukabudik/alza-mcp-community) 📇 🏠 - Unofficial MCP server for Alza.cz (CZ, SK, HU, AT, DE, UK): product search, details, reviews and pickup points. Account, cart and checkout tools are off by default and guarded by one-time confirmation tokens.
```

Suggested PR title: `Add alza-mcp-community (unofficial Alza.cz shopping server)`. PR body: one paragraph from the long description, stating it is unofficial and that the submitter is the maintainer.

## Remaining (needs the owner)

1. Smithery: add server (needs the owner's Smithery account).
2. Glama: claim listing and pass its checks.
3. PulseMCP: submit, or wait for registry ingestion after the first release with registry publishing.
4. mcp.so: submit.
5. awesome-mcp-servers PR.
