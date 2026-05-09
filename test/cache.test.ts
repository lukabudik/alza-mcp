import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "../src/infra/cache.js";

describe("TtlCache", () => {
  it("returns cached values within TTL", () => {
    const c = new TtlCache<string, number>(1000);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
  });

  it("expires entries past TTL", () => {
    vi.useFakeTimers();
    try {
      const c = new TtlCache<string, number>(100);
      c.set("a", 1);
      vi.advanceTimersByTime(150);
      expect(c.get("a")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("memoizes async loaders", async () => {
    const c = new TtlCache<string, number>(1000);
    let calls = 0;
    const loader = async () => {
      calls++;
      return 42;
    };
    expect(await c.memoize("a", loader)).toBe(42);
    expect(await c.memoize("a", loader)).toBe(42);
    expect(calls).toBe(1);
  });

  it("evicts oldest when over maxSize", () => {
    const c = new TtlCache<string, number>(60_000, 2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });
});
