import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { buildIssueDraft, redact, RecentErrors, shellQuote, type Diagnostics } from "../src/infra/issue-report.js";

process.env.ALZA_TOKEN_FILE = "none";

const DIAG: Diagnostics = {
  version: "9.9.9",
  node: "v22.0.0",
  platform: "linux x64",
  storefront: "https://www.alza.cz",
  transport: "stdio",
  fingerprintSidecar: "enabled",
  proxy: "not set",
};

describe("redact", () => {
  it("removes credentials and personal data", () => {
    const input = [
      "alza://identity?code=SECRETCODE123&scope=openid&state=STATE456",
      '{"access_token":"abc.def","refresh_token": "r3fr3sh"}',
      "Authorization: Bearer eyJhbGciOi.payload.sig",
      "mail jan.novak@example.cz or call +420 777 123 456",
      "GET https://webapi.alza.cz/api/users/1234567/v1/basket",
      "visitor 0123456789abcdef0123456789abcdef",
      "token aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI3kM5oQ7s",
      "stack at /home/janek/.npm/_npx/alza-mcp/dist/index.js",
    ].join("\n");
    const { text, count } = redact(input);
    for (const secret of ["SECRETCODE123", "STATE456", "abc.def", "r3fr3sh", "jan.novak@example.cz", "777 123 456", "1234567", "0123456789abcdef", "aB3dE5gH7jK9", "janek"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("scope=openid");
    expect(text).toContain("/users/<id>/v1/basket");
    expect(count).toBeGreaterThanOrEqual(10);
  });

  it.each([
    ["lowercase bearer", "bearer lowercasetoken12345", "lowercasetoken12345"],
    ["Basic auth", "Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA"],
    ["Cookie header", "Cookie: cf_clearance=XyZ.123-abc; sid=abc123", "XyZ.123-abc"],
    ["Set-Cookie header", "Set-Cookie: JSESSIONID=SESS-9f8e7d; Path=/; HttpOnly", "SESS-9f8e7d"],
    ["api_key", "api_key=KEY-1234-abcd", "KEY-1234-abcd"],
    ["x-api-key header", "x-api-key: KEY-5678-efgh", "KEY-5678-efgh"],
    ["apikey in JSON", '{"apikey":"KEY 9 with space"}', "with space"],
    ["UUID visitor id", "visitor 123e4567-e89b-12d3-a456-426614174000", "123e4567"],
    ["URL userinfo", "https://user:pass@www.alza.cz/x", "user:pass"],
    ["token query value", "https://www.alza.cz/x?token=TOK123&country=CZ", "TOK123"],
    ["fragment code", "alza://identity#code=OAUTHCODE987&state=ST1", "OAUTHCODE987"],
    ["bare long code", "callback code=abcdefghijklmnop1234", "abcdefghijklmnop1234"],
    ["quoted value with spaces", 'password: "correct horse battery"', "horse battery"],
    ["%40-encoded e-mail", "mail=jan.novak%40example.cz", "jan.novak"],
    ["Unicode e-mail", "řeřicha.čech@příklad.cz wrote", "řeřicha"],
    ["local phone (spaced)", "call 777 123 456 now", "777 123 456"],
    ["local phone (contiguous)", "call 777123456 now", "777123456"],
    ["00-prefixed phone", "call 00420777123456 now", "777123456"],
    ["userId", "userId=U-889900 and user_id: 55", "U-889900"],
    ["invoiceNumber", "invoiceNumber=2026123456", "2026123456"],
    ["commodityClientId", "commodityClientId=99887766", "99887766"],
    ["arbitrary query value", "GET /whisper?country=CZ&searchTerm=iphone+secret", "iphone"],
  ])("redacts %s", (_name, input, secret) => {
    const { text, count } = redact(input);
    expect(text).not.toContain(secret);
    expect(count).toBeGreaterThan(0);
  });

  it("keeps harmless query values and the host when redacting userinfo", () => {
    const { text } = redact("https://user:pass@www.alza.cz/x?country=CZ&token=T1");
    expect(text).toContain("https://<redacted>@www.alza.cz/x?country=CZ");
  });

  it("keeps product codes, ids and long lowercase URL slugs", () => {
    const input = "get_product code RI045b1 at https://www.alza.cz/apple-iphone-17-pro-max-256gb-cosmic-orange-d12345678.htm (postal 500 02)";
    expect(redact(input)).toEqual({ text: input, count: 0 });
  });
});

describe("buildIssueDraft", () => {
  it("builds a redacted body, gh commands and a prefilled URL", () => {
    const errors = new RecentErrors(3);
    for (let i = 0; i < 5; i++) errors.record("search_products", `Alza upstream returned 500: boom ${i}`, new Date("2026-10-07T10:00:00Z"));
    const draft = buildIssueDraft(
      {
        category: "alza_change",
        title: "search_products returns HTTP 500 for 'monitor'",
        what_happened: "Every search fails. My email is jan@example.cz.",
        tool: "search_products",
        steps: ["search_products({query: \"monitor\"})"],
        expected: "A product list.",
      },
      DIAG,
      errors.list(),
    );
    expect(draft.repo).toBe("lukabudik/alza-mcp-community");
    expect(draft.labels).toEqual(["endpoint-broken"]);
    expect(draft.title).toBe("Endpoint broken: search_products returns HTTP 500 for 'monitor'");
    expect(draft.body).not.toContain("jan@example.cz");
    expect(draft.body).toContain("- alza-mcp-community version: 9.9.9");
    expect(draft.body).toContain("- Proxy (`ALZA_PROXY_URL`): not set");
    expect(draft.body).toContain("1. search_products({query: \"monitor\"})");
    // The ring buffer keeps the 3 most recent errors.
    expect(draft.recent_errors_included).toBe(3);
    expect(draft.body).toContain("boom 4");
    expect(draft.body).not.toContain("boom 1");
    expect(draft.redactions).toBe(1);

    expect(draft.gh_create_command).toContain("gh issue create --repo lukabudik/alza-mcp-community --title 'Endpoint broken: search_products returns HTTP 500 for '\\''monitor'\\''' --label 'endpoint-broken' --body-file - <<'ALZA_MCP_ISSUE_BODY'\n");
    expect(draft.gh_create_command.endsWith("\nALZA_MCP_ISSUE_BODY")).toBe(true);
    expect(draft.gh_search_command).toBe("gh issue list --repo lukabudik/alza-mcp-community --state all --search 'search_products returns HTTP 500 for monitor'");

    const url = new URL(draft.new_issue_url);
    expect(url.origin + url.pathname).toBe("https://github.com/lukabudik/alza-mcp-community/issues/new");
    expect(url.searchParams.get("title")).toBe(draft.title);
    expect(url.searchParams.get("labels")).toBe("endpoint-broken");
    expect(url.searchParams.get("body")).toBe(draft.body);
    expect(draft.url_body_truncated).toBe(false);
  });

  it("reduces recent errors to route and status, dropping query values and HTML bodies", () => {
    const errors = new RecentErrors();
    errors.record(
      "autocomplete",
      "GET https://www.alza.cz/api/whisper?country=CZ&visitor=123e4567-e89b-12d3-a456-426614174000&searchTerm=iphone failed with HTTP 403: <!DOCTYPE html><html>Just a moment... cf</html>",
    );
    const draft = buildIssueDraft({ category: "bug", title: "t", what_happened: "w" }, DIAG, errors.list());
    expect(draft.body).toContain("HTTP 403");
    expect(draft.body).toContain("/api/whisper?<query>");
    for (const leak of ["123e4567", "iphone", "Just a moment", "DOCTYPE"]) expect(draft.body).not.toContain(leak);
  });

  it("omits recent errors on request and truncates an over-long URL body", () => {
    const errors = new RecentErrors();
    errors.record("get_product", "Timeout 30000ms exceeded");
    const draft = buildIssueDraft(
      { category: "bug", title: "Huge report", what_happened: "příliš žluťoučký kůň ".repeat(150), include_recent_errors: false },
      DIAG,
      errors.list(),
    );
    expect(draft.recent_errors_included).toBe(0);
    expect(draft.body).not.toContain("Timeout");
    expect(draft.new_issue_url.length).toBeLessThanOrEqual(7000);
    expect(draft.url_body_truncated).toBe(true);
    expect(new URL(draft.new_issue_url).searchParams.get("body")).toContain("Truncated to fit a URL");
  });

  it("cannot be broken out of by a body containing the heredoc delimiter", () => {
    const draft = buildIssueDraft({ category: "bug", title: "Delimiter test", what_happened: "line\nALZA_MCP_ISSUE_BODY\nrm -rf ~" }, DIAG, []);
    const lines = draft.gh_create_command.split("\n");
    expect(lines.filter((l) => l === "ALZA_MCP_ISSUE_BODY")).toHaveLength(1);
    expect(lines.at(-1)).toBe("ALZA_MCP_ISSUE_BODY");
  });

  it("shell-quotes single quotes", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("report_issue over MCP", () => {
  it("is visible by default, drafts an issue, and unexpected tool errors point to it", async () => {
    const built = buildServer();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "report-issue-test", version: "0" });
    await built.server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("report_issue");
      expect(client.getInstructions()).toContain("report_issue");

      // Invalid arguments are the caller's mistake: no report hint, nothing recorded.
      const invalid = await client.callTool({ name: "set_toolset", arguments: { id: "nope", enabled: true } });
      expect(invalid.isError).toBe(true);

      const res = await client.callTool({
        name: "report_issue",
        arguments: { category: "bug", title: "Example failure", what_happened: "Something broke while testing." },
      });
      expect(res.isError).toBeFalsy();
      const sc = res.structuredContent as { title: string; gh_create_command: string; new_issue_url: string; labels: string[] };
      expect(sc.title).toBe("Example failure");
      expect(sc.labels).toEqual(["bug"]);
      expect(sc.gh_create_command.startsWith("gh issue create --repo lukabudik/alza-mcp-community")).toBe(true);
      expect(sc.new_issue_url.startsWith("https://github.com/lukabudik/alza-mcp-community/issues/new?")).toBe(true);
      const text = (res.content as Array<{ text: string }>)[0]!.text;
      expect(text).toContain("file it only with their consent");
    } finally {
      await client.close();
      await built.close();
    }
  });
});
