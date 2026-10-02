#!/usr/bin/env node
// Non-interactive PKCE login, step 1: print the authorization URL and persist the
// PKCE context so step 2 (alza-auth-exchange.mjs) can finish the token exchange
// after the user completes the browser sign-in. No credentials are read here.
//
//   node scripts/alza-auth-login-noninteractive.mjs
//
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const AUTHORITY = process.env.ALZA_OAUTH_AUTHORITY ?? "https://identity.alza.cz";
const CLIENT_ID = process.env.ALZA_OAUTH_CLIENT_ID ?? "alza_Android";
const REDIRECT_URI = process.env.ALZA_OAUTH_REDIRECT_URI ?? "alza://identity";
const SCOPE = "email openid profile alza offline_access";
const TOKEN_FILE = process.env.ALZA_TOKEN_FILE ?? join(homedir(), ".alza-mcp", "tokens.json");
const PENDING_FILE = join(homedir(), ".alza-mcp", "pending-login.json");
const VISITOR_ID = process.env.ALZA_VISITOR_ID ?? randomUUID();

const base64Url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

async function discovery() {
  const res = await fetch(`${AUTHORITY}/.well-known/openid-configuration`, {
    headers: {
      accept: "application/json",
      "user-agent": "Alza/2026.15.0 (Android)",
      "accept-language": "cs-CZ,cs;q=0.9,en;q=0.8",
      "x-correlation-id": randomUUID(),
      "Balancer-Guid": VISITOR_ID,
    },
  });
  if (!res.ok) {
    console.error(`note: discovery HTTP ${res.status}; using APK defaults (Cloudflare may challenge the GET from this egress)`);
    return {};
  }
  return res.json();
}

const oidc = await discovery();
const authorizationEndpoint = oidc.authorization_endpoint ?? `${AUTHORITY}/connect/authorize`;
const tokenEndpoint = oidc.token_endpoint ?? `${AUTHORITY}/connect/token`;

const verifier = base64Url(randomBytes(32));
const challenge = base64Url(createHash("sha256").update(verifier).digest());
const state = base64Url(randomBytes(32));
const nonce = base64Url(randomBytes(32));

const params = new URLSearchParams({
  client_id: CLIENT_ID,
  response_type: "code",
  scope: SCOPE,
  redirect_uri: REDIRECT_URI,
  code_challenge_method: "S256",
  code_challenge: challenge,
  state,
  nonce,
  countryCode: process.env.ALZA_COUNTRY ?? "CZ",
  culture: process.env.ALZA_CULTURE ?? "cs-CZ",
});
const url = `${authorizationEndpoint}?${params}`;

mkdirSync(dirname(PENDING_FILE), { recursive: true, mode: 0o700 });
writeFileSync(PENDING_FILE, JSON.stringify({ verifier, state, challenge, nonce, url, tokenEndpoint, authorizationEndpoint, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, scope: SCOPE, visitorId: VISITOR_ID, createdAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
chmodSync(PENDING_FILE, 0o600);

console.log(JSON.stringify({
  url,
  state,
  pending_file: PENDING_FILE,
  token_file: TOKEN_FILE,
  note: "Open url in a browser, sign in to your Alza account, then copy the full alza://identity redirect (or just the code) and run: node scripts/alza-auth-exchange.mjs",
}, null, 2));
