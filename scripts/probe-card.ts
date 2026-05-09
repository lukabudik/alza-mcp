#!/usr/bin/env tsx
/**
 * Targeted DOM probe for the search-result card and the product detail page.
 * Used when src/domain/catalog.ts needs updated selectors after an Alza redesign.
 *
 *   npx tsx scripts/probe-card.ts
 *
 * Prints: per-card field probes (name, URL, image, price, rating selectors),
 * follows the first non-sponsored card's link, and dumps the product page's
 * JSON-LD blocks + spec table.
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
  await context.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (t === "image" || t === "media" || t === "font") return route.abort();
    return route.continue();
  });
  const page = await context.newPage();

  await page.goto("https://www.alza.cz/search.htm?exps=keyboard", {
    waitUntil: "commit",
    timeout: 30_000,
  });
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
  await page.waitForSelector(".browsingitem", { timeout: 15_000 });

  // Use a string-of-source eval to avoid tsx's __name decorator on arrow funcs.
  const samples = await page.evaluate(`(function() {
    var cards = Array.from(document.querySelectorAll('.browsingitem')).slice(0, 5);
    return cards.map(function(card) {
      function text(sel) {
        var el = card.querySelector(sel);
        return el ? el.textContent.trim().replace(/\\s+/g, ' ') : null;
      }
      function attr(sel, a) {
        var el = card.querySelector(sel);
        return el ? el.getAttribute(a) : null;
      }
      return {
        dataCode: card.getAttribute('data-code'),
        dataId: card.getAttribute('data-id'),
        sponsored: !!card.querySelector('.box-recommendation'),
        name_a_name: text('a.name'),
        name_browsingitem_name: text('.name'),
        href_a: attr('a', 'href'),
        href_a_name: attr('a.name', 'href'),
        href_first_htm: attr('a[href*=".htm"]', 'href'),
        img_src: attr('img', 'src'),
        img_data_src: attr('img', 'data-src'),
        price_text: text('.price'),
        price_box: text('.price-box'),
        price_browsing: text('.browsingitem-price'),
        price_action: text('.price-action'),
        price_normal: text('.price-normal'),
        price_jsBox: text('.js-price'),
        price_class_price: text('[class*=price]'),
        avail_text: text('.avail'),
        avail_avlb: text('.avlb'),
        rating_class: text('.rating'),
        sample_text: card.textContent.trim().replace(/\\s+/g, ' ').slice(0, 240)
      };
    });
  })()`);

  console.log(JSON.stringify(samples, null, 2));

  const productUrl = await page.evaluate(`(function() {
    var cards = Array.from(document.querySelectorAll('.browsingitem'));
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.querySelector('.box-recommendation')) continue;
      var a = c.querySelector('a.name') || c.querySelector('a[href*=".htm"]');
      if (a && a.href) return a.href;
    }
    return null;
  })()`) as string | null;

  console.log("\nproduct URL: " + productUrl);

  if (productUrl) {
    await page.goto(productUrl, { waitUntil: "commit", timeout: 30_000 });
    await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});

    const productData = await page.evaluate(`(function() {
      function text(sel) { var el = document.querySelector(sel); return el ? el.textContent.trim().replace(/\\s+/g, ' ') : null; }
      function attr(sel, a) { var el = document.querySelector(sel); return el ? el.getAttribute(a) : null; }
      return {
        title: document.title,
        url: location.href,
        h1: text('h1'),
        priceClass: text('.price-box__price'),
        priceAction: text('.price-box__price-action'),
        priceCurrent: text('.js-price'),
        priceItemprop: attr('[itemprop="price"]', 'content'),
        availability: text('.avlb'),
        ratingItemprop: attr('[itemprop="ratingValue"]', 'content'),
        ratingCount: attr('[itemprop="reviewCount"]', 'content'),
        params: Array.from(document.querySelectorAll('.paramTbl tr')).slice(0, 20).map(function(tr) {
          var th = tr.querySelector('th'), td = tr.querySelector('td');
          return { k: th ? th.textContent.trim().replace(/\\s+/g,' ') : null, v: td ? td.textContent.trim().replace(/\\s+/g,' ') : null };
        }).filter(function(r) { return r.k && r.v; }),
        breadcrumbs: Array.from(document.querySelectorAll('.crumbs a, .breadcrumbs a, nav[aria-label*=Breadcrumb] a')).map(function(a) { return a.textContent.trim(); }).slice(0, 8)
      };
    })()`);

    console.log("\n--- PRODUCT PAGE ---");
    console.log(JSON.stringify(productData, null, 2));

    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    for (let i = 0; i < ld.length; i++) {
      const blob = ld[i] ?? "";
      console.log("\n--- JSON-LD [" + i + "] (" + blob.length + " chars) ---");
      try {
        const parsed = JSON.parse(blob);
        const out = JSON.stringify(parsed, null, 2);
        console.log(out.length > 1800 ? out.slice(0, 1800) + "\n... [truncated]" : out);
      } catch {
        console.log(blob.slice(0, 500));
      }
    }

    await writeFile("/tmp/alza-product-real.html", await page.content());
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
