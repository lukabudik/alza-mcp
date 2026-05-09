import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractJsonLd, findProduct } from "../src/infra/jsonld.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("jsonld", () => {
  it("extracts a Product from a real product page fixture", async () => {
    const html = await readFile(join(here, "fixtures/product-page.html"), "utf8");
    const blocks = extractJsonLd(html);
    expect(blocks.length).toBeGreaterThan(0);
    const product = findProduct(blocks);
    expect(product).toBeDefined();
    expect(product?.name).toContain("iPhone 15 Pro");
    expect(product?.sku).toBe("WEXOA002B0");
    expect(product?.brand).toBe("Apple");
    expect(product?.offers?.price).toBe(28490);
    expect(product?.offers?.priceCurrency).toBe("CZK");
    expect(product?.aggregateRating?.ratingValue).toBe(4.7);
    expect(product?.aggregateRating?.reviewCount).toBe(1284);
    expect(product?.review).toHaveLength(2);
    expect(product?.review?.[0]?.author).toBe("Petr N.");
  });

  it("tolerates malformed JSON-LD", () => {
    const html = `
      <script type="application/ld+json">{"not":"valid"</script>
      <script type="application/ld+json">{"@type":"Product","name":"OK"}</script>
    `;
    const blocks = extractJsonLd(html);
    const product = findProduct(blocks);
    expect(product?.name).toBe("OK");
  });

  it("handles @graph collections", () => {
    const html = `
      <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList"},
        {"@type":"Product","name":"From graph","sku":"X"}
      ]}
      </script>
    `;
    const blocks = extractJsonLd(html);
    const product = findProduct(blocks);
    expect(product?.name).toBe("From graph");
  });
});
