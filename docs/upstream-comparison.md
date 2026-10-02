# Comparison with lukabudik/alza-mcp (upstream)

Checked 2026-10-02 against `lukabudik/alza-mcp` HEAD `c371ae6` (v0.1.2, 2026-05-11).

**Relationship.** This repository is a strict descendant: upstream's 9 commits are the first 9 of ours, and upstream has no commits we lack. We are 26 commits ahead (v0.3.0). Same MIT license (`alza-mcp contributors`), same dependency set.

| | upstream v0.1.2 | this repo v0.3.0 |
|---|---|---|
| Positioning | "read-only window into the Alza catalog … No credentials, no purchases — just research" | Full purchase path plus account management |
| Tools | 5 (catalog reads) | 54 domain tools + `list_toolsets`/`set_toolset` |
| Writes | none | cart, checkout, order placement and cancellation, payments, registration, password/2FA/phone/email changes, account deletion |
| Bot protection | "Rather than fight Cloudflare, drives a real browser … no fingerprint games" | Headless Chromium plus a `curl_cffi` Chrome-fingerprint sidecar (checkout only) |
| Auth | none | OAuth PKCE; APK-embedded client secret as default |
| Filtering | price / stock / sort / category | adds per-category attribute filters (`list_category_filters`, `filters`, `producer_ids`) and a name-based screen-size filter |
| Tool exposure | all listed | grouped into toolsets; only `catalog` + `auth` enabled by default |
| Source size | ~2.1k lines (`src/`), 6 test files | ~6.9k lines, 16 test files |
| Repo contents | 54 files | 215 files, including `docs/live-evidence/` (77 files) and ~39 scratch scripts in `scripts/` |

## What upstream said it would not do

Upstream's README gives reasons for staying read-only: (1) "running an MCP server that holds your Alza credentials is a much higher bar than a read-only catalog browser", and it declines to fight Cloudflare. This fork deliberately does both. That is a different product under the same package name, MCP registry id (`io.github.lukabudik/alza-mcp`) and README title. Before publishing:

- Decide whether to publish as a separate project (new npm name, registry id, repo URL, `package.json`/`server.json`/publish-workflow owner) rather than trading on upstream's name and `lukabudik` identifiers, which all still appear here.
- Agree with the upstream author, or credit them clearly, since 9 commits and the original design are theirs.
- Expect a materially higher legal/ToS and abuse surface than upstream (see README Disclaimer and SECURITY.md).

## Where upstream is better

- Smaller and easier to audit; no secrets, no personal data, no live-account captures.
- Its claims match its behaviour; ours had drifted (the README said "does not bypass bot protection" and "read-only" until this update).
- A conservative trust story that is easy to explain to users.
