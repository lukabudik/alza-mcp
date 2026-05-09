#!/usr/bin/env tsx
/**
 * Run every tool against live Alza and print pass/fail. Use after major
 * frontend updates or when MCP users report tools failing.
 *
 *     npm run validate:api
 */
import { buildServer } from "../src/server.js";
import { Catalog } from "../src/domain/catalog.js";
import { Reviews } from "../src/domain/reviews.js";
import { Pickup } from "../src/domain/pickup.js";
import { AlzaBrowser } from "../src/infra/browser.js";

interface Check {
  name: string;
  fn: () => Promise<unknown>;
}

interface Result {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  sample?: unknown;
}

async function run(): Promise<void> {
  const browser = new AlzaBrowser();
  const catalog = new Catalog(browser);
  const reviews = new Reviews(browser, catalog);
  const pickup = new Pickup(browser.locale);

  const checks: Check[] = [
    {
      name: "search_products('iphone')",
      fn: async () => {
        const r = await catalog.searchProducts({ query: "iphone", limit: 3 });
        if (r.products.length === 0) throw new Error("no products");
        return r.products[0];
      },
    },
    {
      name: "list_categories()",
      fn: async () => {
        const r = await catalog.listCategories();
        return { count: r.length, sample: r.slice(0, 3) };
      },
    },
    {
      name: "get_product (first search hit)",
      fn: async () => {
        const search = await catalog.searchProducts({ query: "iphone", limit: 1 });
        const code = search.products[0]?.code;
        if (!code) throw new Error("no code from search");
        return await catalog.getProduct(code);
      },
    },
    {
      name: "get_product_reviews",
      fn: async () => {
        const search = await catalog.searchProducts({ query: "iphone", limit: 1 });
        const code = search.products[0]?.code;
        if (!code) throw new Error("no code from search");
        return await reviews.getProductReviews(code, 3);
      },
    },
    {
      name: "find_pickup_points (Praha)",
      fn: async () => {
        const points = await pickup.findPickupPoints({ postalCode: "11000", limit: 5 });
        if (points.length === 0) throw new Error("no points");
        return points[0];
      },
    },
  ];

  const results: Result[] = [];
  for (const check of checks) {
    const t0 = Date.now();
    try {
      const sample = await check.fn();
      results.push({ name: check.name, ok: true, durationMs: Date.now() - t0, sample });
      process.stdout.write(`✓ ${check.name} (${Date.now() - t0} ms)\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: check.name, ok: false, durationMs: Date.now() - t0, error: message });
      process.stdout.write(`✗ ${check.name} — ${message}\n`);
    }
  }

  const fs = await import("node:fs/promises");
  await fs.writeFile(
    "validation-results.json",
    JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)
  );

  await browser.close();

  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} checks passed.\n`);

  // Touch buildServer to keep the export real (silence lint).
  void buildServer;

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
