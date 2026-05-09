import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("buildServer", () => {
  it("constructs without launching the browser", () => {
    // The browser is launched lazily on the first tool call. Construction
    // alone must not block or download anything.
    const built = buildServer();
    expect(built.server).toBeDefined();
    expect(typeof built.close).toBe("function");
  });

  it("rejects an unknown ALZA_BASE_URL", () => {
    expect(() => buildServer({ baseUrl: "https://www.example.com" })).toThrow();
  });

  it("close() is idempotent and non-throwing on a never-used browser", async () => {
    const built = buildServer();
    await expect(built.close()).resolves.not.toThrow();
    await expect(built.close()).resolves.not.toThrow();
  });
});
