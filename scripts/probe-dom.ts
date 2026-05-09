#!/usr/bin/env tsx
/**
 * One-off DOM probe — open Alza pages with Playwright, dump the structure,
 * and try common selectors. Use this when Alza redesigns the catalog and
 * the scrapers in src/domain/catalog.ts need new selectors.
 *
 *   npx tsx scripts/probe-dom.ts
 *
 * Output: structured findings to stdout; full HTML saved to /tmp/alza-probe-*.html.
 * Companion scripts: probe-card.ts (card structure) and probe-categories.ts.
 */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "cs-CZ",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  // Block heavy resources to speed everything up.
  await context.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (t === "image" || t === "media" || t === "font") return route.abort();
    return route.continue();
  });
  const page = await context.newPage();

  const targets = [
    { name: "search-q", url: "https://www.alza.cz/search.htm?exps=keyboard" },
    { name: "search-direct", url: "https://www.alza.cz/hledat/keyboard" },
  ];

  for (const t of targets) {
    console.log(`\n=== ${t.name}: ${t.url} ===`);
    try {
      const res = await page.goto(t.url, { waitUntil: "commit", timeout: 30_000 });
      console.log(`  initial status: ${res?.status()}`);
      // Let the page settle.
      await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
      console.log(`  url:    ${page.url()}`);
      console.log(`  title:  ${await page.title()}`);

      const html = await page.content();
      await writeFile(`/tmp/alza-probe-${t.name}.html`, html);
      console.log(`  saved /tmp/alza-probe-${t.name}.html (${html.length} bytes)`);

      const checkSelectors = [
        ".browsingitem",
        "[data-testid='product-card']",
        ".js-categoryListItem",
        "article[itemtype*=Product]",
        "[itemtype*='schema.org/Product']",
        ".productList .item",
        ".productList__item",
        "[data-impression-meta]",
        "[data-product-code]",
        "[class*='browsingitem']",
        "[class*='ProductBox']",
      ];
      for (const sel of checkSelectors) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) console.log(`  ${sel.padEnd(40)} → ${count}`);
      }

      const ldCount = await page.locator('script[type="application/ld+json"]').count();
      console.log(`  jsonld scripts: ${ldCount}`);

      const dump = await page.evaluate(() => {
        const out: Array<{ sel: string; count: number; firstHtml?: string; firstText?: string }> = [];
        const trySels = [
          "[data-testid='product-card']",
          ".browsingitem",
          ".js-categoryListItem",
          "article[itemtype*=Product]",
          "[data-impression-meta]",
          "[data-product-code]",
          "[itemtype*='schema.org/Product']",
        ];
        for (const sel of trySels) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            const first = els[0] as HTMLElement;
            out.push({
              sel,
              count: els.length,
              firstHtml: (first.outerHTML ?? "").slice(0, 1500),
              firstText: (first.textContent ?? "").trim().slice(0, 250).replace(/\s+/g, " "),
            });
          }
        }
        return out;
      });
      for (const c of dump) {
        console.log(`\n  >>> ${c.sel} (${c.count})`);
        console.log(`  text: ${c.firstText}`);
        console.log(`  html: ${c.firstHtml}`);
      }
    } catch (err) {
      console.log(`  ERROR: ${(err as Error).message}`);
    }
  }

  // Also try one product page to map detail/JSON-LD shape.
  try {
    const productUrl = await page.evaluate(() => {
      const link = document.querySelector(
        "a[href*='.htm']"
      ) as HTMLAnchorElement | null;
      return link?.href;
    });
    console.log(`\nfollow-up product url: ${productUrl}`);
    if (productUrl) {
      const res = await page.goto(productUrl, { waitUntil: "commit", timeout: 30_000 });
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
      console.log(`  product status: ${res?.status()}`);
      console.log(`  product title:  ${await page.title()}`);
      const html = await page.content();
      await writeFile(`/tmp/alza-probe-product.html`, html);
      console.log(`  saved /tmp/alza-probe-product.html (${html.length} bytes)`);

      const ld = await page
        .locator('script[type="application/ld+json"]')
        .allTextContents();
      console.log(`  product jsonld scripts: ${ld.length}`);
      ld.forEach((blob, i) => console.log(`  [${i}] ${blob.slice(0, 300).replace(/\s+/g, " ")}`));

      const productCode = await page.evaluate(() => {
        const ms = document.title.match(/[A-Z]{2,}[0-9]+[A-Z0-9]*/);
        return ms?.[0];
      });
      console.log(`  parsed product code from title: ${productCode}`);
    }
  } catch (err) {
    console.log(`  product probe error: ${(err as Error).message}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
