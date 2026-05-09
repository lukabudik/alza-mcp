import { describe, expect, it } from "vitest";
import { listSupportedLocales, resolveLocale } from "../src/infra/locale.js";

describe("locale", () => {
  it("defaults to alza.cz", () => {
    const locale = resolveLocale();
    expect(locale.countryCode).toBe("CZ");
    expect(locale.currency).toBe("CZK");
  });

  it("resolves alza.sk", () => {
    const locale = resolveLocale("https://www.alza.sk");
    expect(locale.countryCode).toBe("SK");
    expect(locale.currency).toBe("EUR");
  });

  it("strips trailing slash", () => {
    const locale = resolveLocale("https://www.alza.cz/");
    expect(locale.baseUrl).toBe("https://www.alza.cz");
  });

  it("rejects unknown base URL", () => {
    expect(() => resolveLocale("https://www.example.com")).toThrow();
  });

  it("lists all supported locales", () => {
    const list = listSupportedLocales();
    expect(list).toContain("https://www.alza.cz");
    expect(list).toContain("https://www.alza.sk");
    expect(list.length).toBeGreaterThanOrEqual(6);
  });
});
