import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileApi } from "../src/infra/mobile-api.js";
import { MobileAccount } from "../src/domain/mobile-account.js";

// Keep unit tests deterministic: never auto-load a real stored OAuth token.
process.env.ALZA_TOKEN_FILE = "none";

type Seen = { url: string; method: string; headers: Record<string, string>; body: string | null };
type Handler = (req: Seen) => Response;

function withFetch(handler: Handler, seen: Seen[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(
      new Headers(init?.headers as Headers | Record<string, string> | undefined).entries(),
    ) as Record<string, string>;
    const body = init?.body == null ? null : String(init.body);
    seen.push({ url, method: init?.method ?? "GET", headers, body });
    return handler({ url, method: init?.method ?? "GET", headers, body });
  }) as typeof fetch;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const makeApi = () => new MobileApi({ visitorId: "visitor-test", baseUrl: "https://test.alza.invalid" });
const makeAccount = () => new MobileAccount(makeApi());

describe("task-5 read-side dynamic actions (A17 / OR6 / OR10 / K2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("OR6 order_search: validates the term and posts a form-urlencoded search", async () => {
    const account = makeAccount();
    const uid = "100000001";
    // validation
    await expect(account.orderSearch("   ", uid)).rejects.toThrow(/search_term/);
    await expect(account.orderSearch("x".repeat(65), uid)).rejects.toThrow(/search_term/);
    await expect(account.orderSearch("1058", "")).rejects.toThrow(/user_id/);

    const seen: Seen[] = [];
    vi.stubGlobal("fetch", withFetch((req) => {
      expect(req.url).toContain("/api/users/100000001/v1/orders/search/results");
      expect(req.method).toBe("POST");
      expect(req.headers["content-type"]).toContain("application/x-www-form-urlencoded");
      expect(req.body).toContain("searchTerm=1058");
      expect(req.body).toContain("productFilterType=0");
      return json({ orders: [{ id: "1058", documents: [{ name: "Faktura", self: { href: "https://pdf.alza.cz/Apps/pdfdoc.asp?d=1058P" } }] }], commodities: [] });
    }, seen));
    try {
      const out = (await account.orderSearch("1058", uid)) as Record<string, unknown>;
      expect((out as { orders: unknown[] }).orders).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("A17 gdpr_info: reads the section and the export dialog", async () => {
    const account = makeAccount();
    const seen: Seen[] = [];
    vi.stubGlobal("fetch", withFetch((req) => {
      if (req.url.endsWith("/userAccount/personalDetails?country=CZ")) {
        return json({ title: "Osobní údaje", gdprInfoAction: { form: { meta: { href: "https://test.alza.invalid/v1/userAccount/gdprDialog" } } }, deleteAccountAction: { form: { meta: { href: "https://test.alza.invalid/v1/userAccount/delete" } } } });
      }
      if (req.url.endsWith("/userAccount/gdprDialog")) {
        return json({ title: "Export", emailInfo: "user@example.test", sendGdprInfoForm: { form: { meta: { href: "https://test.alza.invalid/v1/userAccount/gdprInformation" } } } });
      }
      throw new Error(`unexpected url ${req.url}`);
    }, seen));
    try {
      const out = (await account.gdprInfo("100000001")) as { personalDetails: Record<string, unknown>; gdprDialog: Record<string, unknown> };
      expect(out.personalDetails.gdprInfoAction).toBeTruthy();
      expect(out.gdprDialog.emailInfo).toBe("user@example.test");
      expect(seen).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("A17 gdpr_info: keeps the section visible if the dialog read fails", async () => {
    const account = makeAccount();
    vi.stubGlobal("fetch", withFetch((req) => {
      if (req.url.endsWith("/userAccount/personalDetails?country=CZ")) {
        return json({ title: "Osobní údaje", gdprInfoAction: { form: { meta: { href: "x" } } } });
      }
      return json({ message: "boom" }, 500);
    }, []));
    try {
      const out = (await account.gdprInfo("100000001")) as { personalDetails: Record<string, unknown>; gdprDialog: Record<string, unknown> };
      expect(out.personalDetails.title).toBe("Osobní údaje");
      expect(String(out.gdprDialog.error)).toMatch(/500/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("A17 gdpr_export: requires a one-time mutation token and a numeric user_id", async () => {
    const account = makeAccount();
    // no prepared mutation → token guard rejects
    await expect(account.gdprExport({ user_id: "100000001" }, "not-a-token")).rejects.toThrow(/gdpr_export confirmation token/);
    // prepared but the token does not match
    account.prepareMutation("gdpr_export");
    await expect(account.gdprExport({ user_id: "100000001" }, "wrong")).rejects.toThrow(/confirmation token/);
    // invalid user_id
    const badPrep = account.prepareMutation("gdpr_export");
    await expect(account.gdprExport({ user_id: "abc" }, badPrep.confirmationToken)).rejects.toThrow(/user_id/);

    // happy path: prepare → POST 202
    const prep = account.prepareMutation("gdpr_export");
    vi.stubGlobal("fetch", withFetch((req) => {
      expect(req.url).toContain("/v1/userAccount/gdprInformation");
      expect(req.method).toBe("POST");
      return new Response(null, { status: 202 });
    }, []));
    try {
      await expect(account.gdprExport({ user_id: "100000001" }, prep.confirmationToken)).resolves.toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("K2 claim_detail: requires a well-formed AppAction and executes it read-only", async () => {
    const account = makeAccount();
    await expect(account.claimDetail({} as never)).rejects.toThrow(/action/);
    await expect(account.claimDetail({ form: { meta: { href: "" } } } as never)).rejects.toThrow(/form\.meta\.href/);

    const action = { form: { meta: { href: "https://test.alza.invalid/api/v1/complaints/claims/9/detail", method: "GET" } } };
    const seen: Seen[] = [];
    vi.stubGlobal("fetch", withFetch((req) => {
      expect(req.url).toContain("/api/v1/complaints/claims/9/detail");
      return json({ claimId: "9", state: "PROCESSED" });
    }, seen));
    try {
      const out = (await account.claimDetail(action as never)) as Record<string, unknown>;
      expect(out.claimId).toBe("9");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("OR10 order_document: rejects missing href, non-HTTPS, and non-Alza origins", async () => {
    const account = makeAccount();
    await expect(account.orderDocument({} as never)).rejects.toThrow(/self\.href/);
    await expect(account.orderDocument({ self: { href: "not-a-url" } } as never)).rejects.toThrow(/absolute URL/);
    await expect(account.orderDocument({ self: { href: "http://www.alza.cz/x.pdf" } } as never)).rejects.toThrow(/HTTPS/);
    await expect(account.orderDocument({ self: { href: "https://evil.example/x.pdf" } } as never)).rejects.toThrow(/allowed Alza origin/);
  });

  it("OR10 order_document: returns base64 for binary PDF and text for JSON bodies", async () => {
    const account = makeAccount();
    // binary PDF
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    let seen: Seen[] = [];
    vi.stubGlobal("fetch", withFetch(() => new Response(pdfBytes, { status: 200, headers: { "content-type": "application/pdf" } }), seen));
    try {
      const out = (await account.orderDocument({ name: "Faktura", self: { href: "https://pdf.alza.cz/Apps/pdfdoc.asp?d=1058P" } } as never)) as { name: string | null; base64: string | null; text: string | null };
      expect(out.name).toBe("Faktura");
      expect(out.text).toBeNull();
      expect(Buffer.from(out.base64 as string, "base64").equals(pdfBytes)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    // text JSON
    seen = [];
    vi.stubGlobal("fetch", withFetch(() => json({ id: "1058" }), seen));
    try {
      const out = (await account.orderDocument({ self: { href: "https://api.alza.cz/v1/orders/1058" } } as never)) as { text: string | null; base64: string | null };
      expect(out.base64).toBeNull();
      expect(JSON.parse(out.text as string).id).toBe("1058");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("OR10 order_document: blocks a redirect away from the allowlisted origin", async () => {
    const account = makeAccount();
    vi.stubGlobal("fetch", withFetch(() => new Response(null, { status: 302, headers: { location: "https://evil.example/x.pdf" } }), []));
    await expect(account.orderDocument({ self: { href: "https://pdf.alza.cz/Apps/pdfdoc.asp?d=1058P" } } as never)).rejects.toThrow(/redirected/);
    vi.unstubAllGlobals();
  });
});
