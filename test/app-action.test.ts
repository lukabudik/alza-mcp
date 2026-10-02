import { describe, expect, it } from "vitest";
import { AppActionExecutor, type ServerAppAction } from "../src/infra/app-action.js";

const getAction = (overrides: Partial<ServerAppAction> = {}): ServerAppAction => ({
  form: { meta: { href: "/api/test", method: "GET" }, values: [] },
  ...overrides,
});

describe("AppActionExecutor security boundary", () => {
  it("serializes GET values as APK-style query parameters and injects visitor identity", async () => {
    let seenUrl = "";
    const executor = new AppActionExecutor({
      baseUrl: "https://test.alza.invalid",
      visitorId: "visitor-1",
      userId: 42,
      fetchImpl: async (input) => {
        seenUrl = String(input);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await executor.execute(getAction({ form: { meta: { href: "/api/test?existing=old", method: "GET" }, values: [
      { name: "existing", value: "new" },
      { name: "tags", value: ["a", "b"], kind: "text-array" },
    ] } }));

    const url = new URL(seenUrl);
    expect(url.origin).toBe("https://test.alza.invalid");
    expect(url.pathname).toBe("/api/test");
    expect(url.searchParams.get("existing")).toBe("new");
    expect(url.searchParams.get("tags[0]")).toBe("a");
    expect(url.searchParams.get("tags[1]")).toBe("b");
    expect(url.searchParams.get("visitorId")).toBe("visitor-1");
    expect(url.searchParams.get("userId")).toBe("42");
  });

  it("serializes POST values as JSON and requires explicit mutation confirmation", async () => {
    let seenInit: RequestInit | undefined;
    const executor = new AppActionExecutor({
      baseUrl: "https://test.alza.invalid",
      visitorId: "visitor-1",
      fetchImpl: async (_input, init) => {
        seenInit = init;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    const action = getAction({ form: { meta: { href: "/services/restservice.svc/test", method: "POST" }, values: [{ name: "enabled", value: true, kind: "boolean" }] } });

    await expect(executor.execute(action)).rejects.toThrow(/explicit confirmation/);
    await executor.execute(action, { allowMutation: true, confirmationToken: "local-test-confirmation" });
    expect(seenInit?.method).toBe("POST");
    expect(JSON.parse(String(seenInit?.body))).toEqual({ enabled: true, visitorId: "visitor-1" });
  });

  it("supports multipart actions without forcing an application/json content type", async () => {
    let seenInit: RequestInit | undefined;
    const executor = new AppActionExecutor({
      baseUrl: "https://test.alza.invalid",
      visitorId: "visitor-1",
      fetchImpl: async (_input, init) => {
        seenInit = init;
        return new Response("{}", { status: 200 });
      },
    });
    await executor.execute({ form: { meta: { href: "/api/upload", rel: ["multipart"], method: "POST" }, values: [{ name: "title", value: "hello" }] } }, { allowMutation: true, confirmationToken: "local-test-confirmation" });
    expect(seenInit?.body).toBeInstanceOf(FormData);
    expect(new Headers(seenInit?.headers).get("content-type")).toBeNull();
  });

  it("blocks external origins, insecure URLs, disallowed paths, methods, redirects, and sensitive fields", async () => {
    const executor = new AppActionExecutor({
      baseUrl: "https://test.alza.invalid",
      visitorId: "visitor-1",
      fetchImpl: async () => new Response("", { status: 302, headers: { location: "https://evil.invalid" } }),
    });
    await expect(executor.execute(getAction({ form: { meta: { href: "https://evil.invalid/api/test" }, values: [] } }))).rejects.toThrow(/outside the allowed origin/);
    await expect(executor.execute(getAction({ form: { meta: { href: "http://test.alza.invalid/api/test" }, values: [] } }))).rejects.toThrow(/outside the allowed origin/);
    await expect(executor.execute(getAction({ form: { meta: { href: "/private/test" }, values: [] } }))).rejects.toThrow(/outside the allowlist/);
    await expect(executor.execute(getAction({ form: { meta: { href: "/api/test", method: "PATCH" }, values: [] } }))).rejects.toThrow(/method is not allowed/);
    await expect(executor.execute(getAction({ form: { meta: { href: "/api/test" }, values: [{ name: "access_token", value: "secret" }] } }))).rejects.toThrow(/Sensitive AppAction field/);
    await expect(executor.execute(getAction())).rejects.toThrow(/outside the allowed origin/);
  });

  it("rejects disabled actions", async () => {
    const executor = new AppActionExecutor({ baseUrl: "https://test.alza.invalid", visitorId: "visitor-1", fetchImpl: async () => new Response("{}") });
    await expect(executor.execute({ enabled: false, form: { meta: { href: "/api/test" } } })).rejects.toThrow(/disabled/);
  });

  it("merges typed extra values into the form payload (user values win on conflict)", async () => {
    let seenInit: RequestInit | undefined;
    const executor = new AppActionExecutor({
      baseUrl: "https://test.alza.invalid",
      visitorId: "visitor-1",
      fetchImpl: async (_input, init) => { seenInit = init; return new Response("{}", { status: 200 }); },
    });
    const action: ServerAppAction = { form: { meta: { href: "/services/restservice.svc/v1/review", method: "POST", rel: ["form"] }, values: [{ name: "rating", value: 1, kind: "integer" }, { name: "fixed", value: "server", kind: "text" }] } };
    await executor.execute(action, {
      allowMutation: true,
      confirmationToken: "t",
      extraValues: [{ name: "rating", value: 5, kind: "integer" }, { name: "text", value: "great", kind: "text" }],
    });
    expect(JSON.parse(String(seenInit?.body))).toEqual({ rating: 5, fixed: "server", text: "great", visitorId: "visitor-1" });
  });

  it("uploads base64 file parts in multipart actions with MIME and size limits", async () => {
    let seenInit: RequestInit | undefined;
    const executor = new AppActionExecutor({
      baseUrl: "https://test.alza.invalid",
      visitorId: "visitor-1",
      fetchImpl: async (_input, init) => { seenInit = init; return new Response("{}", { status: 200 }); },
    });
    const upload: ServerAppAction = { form: { meta: { href: "/api/complaints/1/attachments", method: "POST", rel: ["multipart"] }, values: [{ name: "note", value: "x" }] } };
    const dataUrl = "data:image/jpeg;base64," + Buffer.from("hello").toString("base64");
    await executor.execute(upload, {
      allowMutation: true,
      confirmationToken: "t",
      files: [{ partName: "attachments", fileName: "a.jpg", mimeType: "image/jpeg", dataUrl }],
    });
    const body = seenInit?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get("attachments") as File).name).toBe("a.jpg");
    expect((body.get("attachments") as File).type).toBe("image/jpeg");
    expect(body.get("note")).toBe("x");

    const noMultipart: ServerAppAction = { form: { meta: { href: "/api/test", method: "POST", rel: ["form"] }, values: [] } };
    await expect(executor.execute(noMultipart, { allowMutation: true, confirmationToken: "t", files: [{ partName: "f", fileName: "a", mimeType: "image/jpeg", dataUrl }] })).rejects.toThrow(/multipart/);
    await expect(executor.execute(upload, { allowMutation: true, confirmationToken: "t", files: [{ partName: "f", fileName: "a", mimeType: "image/tiff", dataUrl }] })).rejects.toThrow(/MIME/);
    await expect(executor.execute(upload, { allowMutation: true, confirmationToken: "t", files: [{ partName: "f", fileName: "a", mimeType: "image/jpeg", dataUrl: "data:image/jpeg;" + Buffer.from("x").toString("base64") }] })).rejects.toThrow(/base64/);
  });
});
