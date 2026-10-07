# Security policy

`alza-mcp-community` is an unofficial, reverse-engineered client that can act on real Alza accounts (cart, checkout, orders, payments, registration, credential changes, account deletion). Please read the [Disclaimer](README.md#disclaimer) first.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately via GitHub's "Report a vulnerability" (Security → Advisories) on this repository. If that is unavailable, open a minimal public issue asking for a private contact channel, without technical details.

Include what you found, how to reproduce it, and the affected version. We aim to acknowledge reports within a few days. This is a volunteer project and no bounty is offered.

In scope: this repository's code and published package (for example a bypass of the one-time-token guard, leaking credentials or tokens into logs or tool output, unsafe handling of server-provided action URLs, command or path injection).

Out of scope: vulnerabilities in Alza's own services (report those to Alza), and the fact that this tool circumvents Cloudflare Bot Management or uses the Android app's embedded OAuth client credential (both are documented and deliberate; see below).

## Trust model

- **Credentials.** The MCP never receives or stores the Alza password for sign-in; OAuth PKCE sign-in happens in the user's browser and the MCP only exchanges the returned code. The server auto-loads tokens from `~/.alza-mcp/tokens.json` if present (written by the `scripts/alza-auth-login*` helper scripts; set `ALZA_TOKEN_FILE=none` to disable). Protect that file like a password; anyone who can read it can act as you on Alza.
- **Credential-bearing tools.** `register`, `change_password`, `phone_change` and `email_change` take sensitive values as tool arguments, which means they enter your agent's context and your MCP client's logs. Only use them when you are comfortable with that, and prefer doing these in Alza's own UI.
- **High-impact actions** (order placement, cancellation, payments, registration, credential changes, account deletion) require a single-use token from `prepare_mutation`, bound to one action. This guards against accidental or injected agent calls; it is **not** user consent. Your MCP client or agent should show the exact action to the user and ask before calling. `delete_account` is irreversible.
- **Prompt injection.** Product pages, reviews and API responses are untrusted input that an agent reads. Do not enable the `basket_and_checkout`, `account_management` or `orders_and_payments` toolsets on an agent that is also browsing untrusted content unless you require human approval for each mutating call. Toolsets are off by default for this reason; enable them only for the task that needs them.
- **Server-provided URLs.** Action URLs returned by Alza are followed only through the origin-validated executor (path allowlist, sensitive-field blocklist, one-time token); there is no arbitrary-URL tool.
- **Embedded OAuth client secret.** The default `alza_Android` client secret in the source was taken from Alza's public Android APK. It is not a secret of this project and grants nothing beyond what the app's own client does; override it with `ALZA_OAUTH_CLIENT_SECRET` if you prefer. Never commit your own tokens.
- **Local data.** The headless browser keeps cookies in memory for the process lifetime. Evidence files under `docs/live-evidence/` are captures from development accounts and are not a source of valid credentials; do not add captures from your real account.

## Supported versions

Only the latest release receives fixes.
