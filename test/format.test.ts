import { describe, expect, it } from "vitest";
import {
  formatCategoryFilters,
  formatPickupPoints,
  formatPrice,
  formatProduct,
  formatReviews,
  formatSearchResult,
} from "../src/tools/format.js";
import type { Product, ProductReviews, SearchResult } from "../src/domain/types.js";

const sampleProduct: Product = {
  code: "WEXOA002B0",
  id: 9182371,
  name: "iPhone 15 Pro 256 GB",
  url: "https://www.alza.cz/iphone-15-pro.htm",
  price: 28490,
  originalPrice: 32990,
  currency: "CZK",
  availability: "in stock",
  rating: 4.8,
  brand: "Apple",
  category: "Mobile phones",
  params: [{ name: "Storage", value: "256 GB" }],
};

describe("format", () => {
  it("formats price with currency", () => {
    expect(formatPrice(28490, "CZK")).toMatch(/CZK/);
    expect(formatPrice(undefined, "CZK")).toBe("—");
  });

  it("formats a single product with markdown", () => {
    const out = formatProduct(sampleProduct);
    expect(out).toContain("# iPhone 15 Pro");
    expect(out).toContain("WEXOA002B0");
    expect(out).toContain("save");
    expect(out).toContain("Storage");
  });

  it("formats search results with multiple products", () => {
    const result: SearchResult = {
      query: "iphone",
      total: 1,
      page: 1,
      pageSize: 20,
      candidatesScanned: 142,
      products: [sampleProduct],
    };
    const out = formatSearchResult(result);
    expect(out).toContain("Top 1 result(s)");
    expect(out).toContain("scanned 142 candidates");
    expect(out).toContain("iPhone 15 Pro");
  });

  it("formats an empty search result with the scan context", () => {
    const out = formatSearchResult({
      query: "xyzzy123",
      total: 0,
      page: 1,
      pageSize: 20,
      candidatesScanned: 24,
      products: [],
    });
    expect(out).toContain("No products found");
    expect(out).toContain("scanned 24 candidates");
  });

  it("formats reviews", () => {
    const reviews: ProductReviews = {
      code: "WEXOA002B0",
      ratingAverage: 4.7,
      reviewCount: 1284,
      reviews: [
        { author: "Petr N.", rating: 5, body: "Great phone." },
      ],
    };
    const out = formatReviews(reviews);
    expect(out).toContain("4.7");
    expect(out).toContain("Petr N.");
    expect(out).toContain("Great phone.");
  });

  it("handles empty pickup points", () => {
    expect(formatPickupPoints([])).toContain("No pickup points");
  });

  it("formats category filters with brands first and flags unfilterable groups", () => {
    const out = formatCategoryFilters({
      categoryId: 18842948,
      brands: [{ valueId: 1396, description: "Dell", count: 109 }],
      groups: [
        { paramId: 18740, name: "Grafické rozhraní", renderType: "Checkbox", filterable: true, values: [{ valueId: 239739715, description: "HDMI" }] },
        { paramId: 17816, name: "Úhlopříčka", renderType: "Slider", filterable: false, values: [] },
      ],
    });
    expect(out.indexOf("Brands")).toBeLessThan(out.indexOf("Grafické rozhraní"));
    expect(out).toContain("Dell (109) → producer_id: 1396");
    expect(out).toContain("HDMI → value_id: 239739715");
    expect(out).toMatch(/Úhlopříčka.*informational only/);
  });
});
