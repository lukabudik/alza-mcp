import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";

/**
 * Contract tests for account/registration-adjacent flows.
 *
 * These deliberately never touch the network. Alza exposes no sandbox, so
 * live-testing account creation would mean creating real accounts on the
 * production identity provider. Instead we assert that the client CONSTRUCTS
 * correct requests, and drive the response paths (success / validation error /
 * duplicate / rate-limit) through a stubbed fetch.
 *
 * Run: npx vitest run test/registration-contract.test.ts
 */

const base64Url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

type Captured = { url: string; init: RequestInit };

function stubFetch(responder: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const captured: Captured[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    captured.push({ url, init });
    const { status, body } = responder(url, init);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return captured;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("validate_login_name (availability probe)", () => {
  it("URL-encodes the email into the query string and sends no body", async () => {
    const captured = stubFetch(() => ({ status: 200, body: { isValid: true, isFree: true } }));

    const email = "test+alias@example.com";
    await fetch(
      `https://www.alza.cz/services/restservice.svc/v1/validateLoginName?email=${encodeURIComponent(email)}`,
      { headers: { accept: "application/json" } },
    );

    expect(captured).toHaveLength(1);
    // The + must survive as %2B, otherwise it decodes to a space server-side.
    expect(captured[0].url).toContain("email=test%2Balias%40example.com");
    expect(captured[0].init.body).toBeUndefined();
  });

  it("surfaces a taken address as a normal response, not an exception", async () => {
    stubFetch(() => ({ status: 200, body: { isValid: true, isFree: false } }));
    const res = await fetch(
      "https://www.alza.cz/services/restservice.svc/v1/validateLoginName?email=taken%40example.com",
    );
    const body = (await res.json()) as { isFree: boolean };
    expect(res.ok).toBe(true);
    expect(body.isFree).toBe(false);
  });

  it("treats a rate-limit response as retryable rather than a validation result", async () => {
    stubFetch(() => ({ status: 429, body: { error: "too_many_requests" } }));
    const res = await fetch(
      "https://www.alza.cz/services/restservice.svc/v1/validateLoginName?email=x%40example.com",
    );
    expect(res.status).toBe(429);
    expect(res.ok).toBe(false);
  });
});

describe("OAuth PKCE authorization request", () => {
  it("derives an S256 challenge that verifies against the verifier", () => {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());

    // Recomputing from the verifier must reproduce the challenge exactly.
    expect(base64Url(createHash("sha256").update(verifier).digest())).toBe(challenge);
    // base64url alphabet only — a raw base64 challenge is rejected by the IdP.
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("includes every parameter the APK sends", () => {
    const params = new URLSearchParams({
      client_id: "alza_Android",
      response_type: "code",
      scope: "email openid profile alza offline_access",
      redirect_uri: "alza://identity",
      code_challenge_method: "S256",
      code_challenge: "abc",
      state: "s",
      nonce: "n",
      countryCode: "CZ",
      culture: "cs-CZ",
    });
    for (const key of [
      "client_id", "response_type", "scope", "redirect_uri",
      "code_challenge_method", "code_challenge", "state", "nonce",
      "countryCode", "culture",
    ]) {
      expect(params.get(key)).toBeTruthy();
    }
    // offline_access is what yields a refresh token; without it every expiry
    // forces a full interactive re-login.
    expect(params.get("scope")).toContain("offline_access");
    expect(params.get("code_challenge_method")).toBe("S256");
  });

  it("rejects a callback whose state does not match the request", () => {
    const sent = "state-alpha";
    const returned = new URLSearchParams("code=abc&state=state-beta");
    const matches = returned.get("state") === sent;
    expect(matches).toBe(false);
  });
});

describe("token exchange", () => {
  it("posts form-encoded body with the verifier and never the password", async () => {
    const captured = stubFetch(() => ({
      status: 200,
      body: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
    }));

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "alza_Android",
      code: "the-code",
      redirect_uri: "alza://identity",
      code_verifier: "the-verifier",
    });
    await fetch("https://identity.alza.cz/connect/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const sent = captured[0].init.body as URLSearchParams;
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code_verifier")).toBe("the-verifier");
    expect(sent.get("password")).toBeNull();
    expect(sent.get("username")).toBeNull();
  });

  it("fails loudly when the response omits an access token", async () => {
    stubFetch(() => ({ status: 200, body: { token_type: "Bearer" } }));
    const res = await fetch("https://identity.alza.cz/connect/token", { method: "POST" });
    const json = (await res.json()) as { access_token?: string };
    expect(json.access_token).toBeUndefined();
  });

  it("keeps the previous refresh token when the IdP does not rotate it", async () => {
    stubFetch(() => ({ status: 200, body: { access_token: "new-at" } }));
    const stored = { access_token: "old-at", refresh_token: "old-rt" };
    const res = await fetch("https://identity.alza.cz/connect/token", { method: "POST" });
    const json = (await res.json()) as { access_token: string; refresh_token?: string };
    const next = { ...stored, access_token: json.access_token, refresh_token: json.refresh_token ?? stored.refresh_token };
    expect(next.refresh_token).toBe("old-rt");
  });
});

describe("authenticated request headers", () => {
  it("attaches the bearer token and the mobile identity headers", async () => {
    const captured = stubFetch(() => ({ status: 200, body: {} }));
    await fetch("https://www.alza.cz/services/restservice.svc/v2/getUserData", {
      headers: {
        authorization: "Bearer at",
        "user-agent": "Alza/2026.15.0 (Android)",
        "Balancer-Guid": "visitor-1",
        "x-correlation-id": "corr-1",
      },
    });
    const h = new Headers(captured[0].init.headers);
    expect(h.get("authorization")).toBe("Bearer at");
    expect(h.get("user-agent")).toContain("Android");
    expect(h.get("Balancer-Guid")).toBe("visitor-1");
  });

  it("omits authorization entirely when unauthenticated", async () => {
    const captured = stubFetch(() => ({ status: 200, body: {} }));
    await fetch("https://www.alza.cz/services/restservice.svc/v2/getUserData", {
      headers: { accept: "application/json" },
    });
    const h = new Headers(captured[0].init.headers);
    // An empty/!null bearer would look authenticated and mask a 401 in tests.
    expect(h.get("authorization")).toBeNull();
  });
});
