import { describe, expect, it } from "vitest";
import { buildFilteredCategoryUrl, compareForSort, parseFacetsResponse, parseScreenInches, passesInStock, pickAdditionalProperties, sortSweepPages } from "../src/domain/catalog.js";
import type { Product } from "../src/domain/types.js";

const p = (over: Partial<Product>): Product => ({
  code: "X1",
  id: 1,
  name: "p",
  url: "https://www.alza.cz/x.htm",
  currency: "CZK",
  ...over,
});

describe("compareForSort", () => {
  it("sorts price-asc ascending, missing prices last", () => {
    const items = [p({ code: "A", price: 300 }), p({ code: "B" }), p({ code: "C", price: 100 })];
    const sorted = [...items].sort((a, b) => compareForSort(a, b, "price-asc"));
    expect(sorted.map((x) => x.code)).toEqual(["C", "A", "B"]);
  });

  it("sorts price-desc descending, missing prices last", () => {
    const items = [p({ code: "A", price: 300 }), p({ code: "B" }), p({ code: "C", price: 100 })];
    const sorted = [...items].sort((a, b) => compareForSort(a, b, "price-desc"));
    expect(sorted.map((x) => x.code)).toEqual(["A", "C", "B"]);
  });

  it("sorts rating descending, missing ratings last", () => {
    const items = [p({ code: "A", rating: 4.2 }), p({ code: "B" }), p({ code: "C", rating: 4.9 })];
    const sorted = [...items].sort((a, b) => compareForSort(a, b, "rating"));
    expect(sorted.map((x) => x.code)).toEqual(["C", "A", "B"]);
  });

  it("leaves order untouched for relevance/newest/undefined", () => {
    const items = [p({ code: "A", price: 300 }), p({ code: "B", price: 100 })];
    for (const sort of ["relevance", "newest", undefined] as const) {
      const sorted = [...items].sort((a, b) => compareForSort(a, b, sort));
      expect(sorted.map((x) => x.code)).toEqual(["A", "B"]);
    }
  });

  it("is antisymmetric on a mixed sample", () => {
    const items = [
      p({ code: "A", price: 139, rating: 4.5 }),
      p({ code: "B", price: 209, rating: 4.7 }),
      p({ code: "C", price: 169 }),
    ];
    for (const sort of ["price-asc", "price-desc", "rating"] as const) {
      const c = (a: Product, b: Product) => compareForSort(a, b, sort);
      for (const a of items) {
        for (const b of items) {
          if (a === b) continue;
          expect(Math.sign(c(a, b))).toBe(-Math.sign(c(b, a)));
        }
      }
    }
  });
});

describe("sortSweepPages", () => {
  it("floors at 2 pages, caps at 3, scales with limit", () => {
    expect(sortSweepPages(1)).toBe(2);
    expect(sortSweepPages(5)).toBe(2);
    expect(sortSweepPages(24)).toBe(2);
    expect(sortSweepPages(48)).toBe(2);
    expect(sortSweepPages(49)).toBe(3);
    expect(sortSweepPages(50)).toBe(3);
  });
});

describe("passesInStock", () => {
  it("keeps everything when the flag is unset", () => {
    expect(passesInStock(p({}), undefined)).toBe(true);
    expect(passesInStock(p({}), false)).toBe(true);
  });

  it("keeps only confirmed in-stock products when in_stock=true", () => {
    expect(passesInStock(p({ availability: "in stock" }), true)).toBe(true);
    expect(passesInStock(p({ availability: "not purchasable now" }), true)).toBe(false);
    // undetermined stock is excluded — the flag is an assertion
    expect(passesInStock(p({}), true)).toBe(false);
  });
});

describe("parseScreenInches", () => {
  it('parses the leading NN" token from Alza display product names', () => {
    expect(parseScreenInches('40" MSI MAG401QR')).toBe(40);
    expect(parseScreenInches('34" AOC CU34G4')).toBe(34);
    expect(parseScreenInches("31,5\" LG 32MR50C-B")).toBe(31.5);
    expect(parseScreenInches("49'' ASUS XG49VQ")).toBe(49);
  });

  it("returns undefined for names with no leading size", () => {
    expect(parseScreenInches("Logitech MX Master 3S")).toBeUndefined();
    expect(parseScreenInches("")).toBeUndefined();
    // a size appearing mid-name doesn't count — only a leading token
    expect(parseScreenInches('USB-C to 40" cable')).toBeUndefined();
  });
});

describe("buildFilteredCategoryUrl", () => {
  const base = "https://www.alza.cz";

  it("builds a bare category URL with no filters", () => {
    expect(buildFilteredCategoryUrl(base, 18876240)).toBe("https://www.alza.cz/18876240.htm");
  });

  it("appends producer ids as -v{id} segments", () => {
    expect(buildFilteredCategoryUrl(base, 18876240, [1432])).toBe("https://www.alza.cz/18876240-v1432.htm");
    expect(buildFilteredCategoryUrl(base, 18876240, [1432, 1299])).toBe("https://www.alza.cz/18876240-v1432-v1299.htm");
  });

  it("appends attribute filters as -par{paramId}-{valueId} segments", () => {
    expect(buildFilteredCategoryUrl(base, 18842948, undefined, [{ paramId: 18740, valueId: 239739715 }])).toBe(
      "https://www.alza.cz/18842948-par18740-239739715.htm"
    );
  });

  it("combines producers and filters (live-verified order: producer(s) then par filters)", () => {
    expect(
      buildFilteredCategoryUrl(base, 18842948, [1432], [{ paramId: 18740, valueId: 239739715 }])
    ).toBe("https://www.alza.cz/18842948-v1432-par18740-239739715.htm");
  });
});

describe("parseFacetsResponse", () => {
  it("flattens groups, marks only Checkbox renderType as filterable, and drops unparseable values", () => {
    const raw = {
      params: [
        {
          groups: [
            {
              params: [
                { tId: 17828, name: "Native contrast", renderType: "Checkbox", values: [{ v: 239718597, desc: "3000:1", cnt: 74 }, { v: undefined, desc: "bad" }] },
                { tId: 17816, name: "Diagonal", renderType: "Slider", values: [{ v: 685.8, desc: '27 "' }] },
              ],
            },
          ],
        },
      ],
    };
    const groups = parseFacetsResponse(raw);
    expect(groups).toHaveLength(2);
    const contrast = groups.find((g) => g.paramId === 17828)!;
    expect(contrast.filterable).toBe(true);
    expect(contrast.values).toEqual([{ valueId: 239718597, description: "3000:1", count: 74 }]);
    const diagonal = groups.find((g) => g.paramId === 17816)!;
    expect(diagonal.filterable).toBe(false);
  });

  it("returns an empty list for a response with no params", () => {
    expect(parseFacetsResponse({})).toEqual([]);
  });
});

describe("pickAdditionalProperties", () => {
  it("extracts name/value pairs from a schema.org PropertyValue[] array", () => {
    const raw = [
      { "@type": "PropertyValue", name: "Počet LAN portů s rychlostí 10 Gbit", value: "4" },
      { "@type": "PropertyValue", name: "RJ-45", value: "5 ×" },
    ];
    expect(pickAdditionalProperties(raw)).toEqual([
      { name: "Počet LAN portů s rychlostí 10 Gbit", value: "4" },
      { name: "RJ-45", value: "5 ×" },
    ]);
  });

  it("drops entries missing a name or value, and handles non-array input", () => {
    expect(pickAdditionalProperties([{ name: "X" }, { value: "Y" }, null, "not an object"])).toEqual([]);
    expect(pickAdditionalProperties(undefined)).toEqual([]);
    expect(pickAdditionalProperties(null)).toEqual([]);
  });
});
