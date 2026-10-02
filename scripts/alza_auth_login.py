#!/usr/bin/env python3
"""Non-interactive OAuth 2.0 Authorization Code + PKCE login for the Alza mobile API.

Two steps so the browser sign-in can happen between turns:

  1. python3 scripts/alza_auth_login.py gen
       -> prints the authorization URL and persists the PKCE context to
          ~/.alza-mcp/pending-login.json
  2. Open the URL in a browser, sign in to your Alza account, copy the full
     alza://identity redirect (or just the code), then:

       python3 scripts/alza_auth_login.py exchange "<redirect-or-code>"
       -> exchanges the code for tokens and stores them in ~/.alza-mcp/tokens.json
          (read by the MCP server via ALZA_TOKEN_FILE / MobileApi).

No password is ever passed to, read by, or stored by this script. Python
`requests` is used because plain Node/undici hits Cloudflare challenges from
this egress while a requests.Session that follows same-origin redirects gets
through (see docs/mobile-endpoint-coverage.md transport note).
"""
import base64
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path

import requests

AUTHORITY = os.environ.get("ALZA_OAUTH_AUTHORITY", "https://identity.alza.cz")
CLIENT_ID = os.environ.get("ALZA_OAUTH_CLIENT_ID", "alza_Android")
REDIRECT_URI = os.environ.get("ALZA_OAUTH_REDIRECT_URI", "alza://identity")
SCOPE = os.environ.get("ALZA_OAUTH_SCOPE", "email openid profile alza offline_access")
# The `alza_Android` OAuth client is confidential: the token endpoint requires the
# APK-embedded client secret (source-verified; see scripts/alza-client-secret.mjs).
# Set ALZA_OAUTH_CLIENT_SECRET="" to omit it (public clients).
CLIENT_SECRET = os.environ.get("ALZA_OAUTH_CLIENT_SECRET", "ZRtjXCjaYFmUbGNvbTK25uctj4nQRT6a")
HOME = Path(os.path.expanduser("~"))
PENDING_FILE = HOME / ".alza-mcp" / "pending-login.json"
TOKEN_FILE = Path(os.environ.get("ALZA_TOKEN_FILE", str(HOME / ".alza-mcp" / "tokens.json")))
VISITOR_ID = os.environ.get("ALZA_VISITOR_ID") or secrets.token_hex(16)
COUNTRY = os.environ.get("ALZA_COUNTRY", "CZ")
CULTURE = os.environ.get("ALZA_CULTURE", "cs-CZ")

HEADERS = {
    "user-agent": "Alza/2026.15.0 (Android)",
    "accept-language": "cs-CZ,cs;q=0.9,en;q=0.8",
    "Balancer-Guid": VISITOR_ID,
}


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def discover(s: requests.Session) -> dict:
    """Discovery is best-effort: from this egress Cloudflare challenges the GET,
    so fall back to the APK's built-in IdentityServer defaults (the same ones
    MobileApi uses when discovery is unavailable)."""
    try:
        r = s.get(f"{AUTHORITY}/.well-known/openid-configuration", headers={"accept": "application/json"}, timeout=30)
        if r.status_code == 200:
            return r.json()
        print(f"note: discovery returned HTTP {r.status_code} (cf-mitigated={r.headers.get('cf-mitigated')}); using APK defaults", file=sys.stderr)
    except requests.RequestException as e:
        print(f"note: discovery unreachable ({e}); using APK defaults", file=sys.stderr)
    return {}


def gen() -> None:
    oidc = discover(session())
    auth_endpoint = oidc.get("authorization_endpoint", f"{AUTHORITY}/connect/authorize")
    token_endpoint = oidc.get("token_endpoint", f"{AUTHORITY}/connect/token")
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    state = b64url(secrets.token_bytes(32))
    nonce = b64url(secrets.token_bytes(32))

    from urllib.parse import urlencode
    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "scope": SCOPE,
        "redirect_uri": REDIRECT_URI,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "state": state,
        "nonce": nonce,
        "countryCode": COUNTRY,
        "culture": CULTURE,
    }
    url = f"{auth_endpoint}?{urlencode(params)}"
    PENDING_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    PENDING_FILE.write_text(json.dumps({
        "verifier": verifier, "state": state, "token_endpoint": token_endpoint,
        "client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI, "visitor_id": VISITOR_ID,
    }, indent=2) + "\n")
    os.chmod(PENDING_FILE, 0o600)
    print(json.dumps({"url": url, "state": state, "pending_file": str(PENDING_FILE),
                      "next": 'python3 scripts/alza_auth_login.py exchange "<alza://identity redirect or code>"'}, indent=2))


def parse_redirect(pasted: str) -> tuple[str, str | None]:
    text = (pasted or "").strip()
    if not text:
        sys.exit("no redirect pasted")
    if "=" not in text:
        return text, None
    query = text[text.index("?") + 1:] if "?" in text else text
    from urllib.parse import parse_qs
    params = parse_qs(query)
    if params.get("error"):
        sys.exit(f"authorization failed: {params['error'][0]} {params.get('error_description', [''])[0]}")
    code = (params.get("code") or [None])[0]
    if not code:
        sys.exit("no `code` found in the pasted value")
    state = (params.get("state") or [None])[0]
    return code, state


def exchange(pasted: str) -> None:
    if not PENDING_FILE.exists():
        sys.exit(f"no pending login at {PENDING_FILE} — run the gen step first")
    pending = json.loads(PENDING_FILE.read_text())
    code, state = parse_redirect(pasted)
    if state and state != pending["state"]:
        sys.exit("state mismatch — the redirect does not belong to this login attempt; start again")
    s = session()
    data = {
        "grant_type": "authorization_code",
        "client_id": pending["client_id"],
        "code": code,
        "redirect_uri": pending["redirect_uri"],
        "code_verifier": pending["verifier"],
    }
    if CLIENT_SECRET:
        data["client_secret"] = CLIENT_SECRET
    r = s.post(pending["token_endpoint"], data=data, headers={"content-type": "application/x-www-form-urlencoded", "accept": "application/json"}, timeout=30)
    if r.status_code != 200:
        sys.exit(f"token exchange failed with HTTP {r.status_code}: {r.text[:300]}")
    tokens = r.json()
    if not tokens.get("access_token"):
        sys.exit("token response contained no access_token")
    store = {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "token_type": tokens.get("token_type", "Bearer"),
        "scope": tokens.get("scope", SCOPE),
        "expires_in": tokens.get("expires_in"),
        "visitor_id": pending["visitor_id"],
    }
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    TOKEN_FILE.write_text(json.dumps(store, indent=2) + "\n")
    os.chmod(TOKEN_FILE, 0o600)
    PENDING_FILE.unlink(missing_ok=True)
    print(json.dumps({"ok": True, "token_file": str(TOKEN_FILE), "expires_in": store["expires_in"], "visitor_id": store["visitor_id"]}, indent=2))


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("gen", "exchange"):
        sys.exit(__doc__)
    if sys.argv[1] == "gen":
        gen()
    else:
        exchange(sys.argv[2] if len(sys.argv) > 2 else sys.stdin.read())
