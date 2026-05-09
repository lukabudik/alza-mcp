import { describe, expect, it } from "vitest";
import {
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
      total: 142,
      page: 1,
      pageSize: 20,
      products: [sampleProduct],
    };
    const out = formatSearchResult(result);
    expect(out).toContain("142 results");
    expect(out).toContain("iPhone 15 Pro");
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
});
