import fs from "node:fs";
import path from "node:path";
import { AlzaBrowser } from "../src/infra/browser.js";

const OUT_PATH = path.resolve(
  process.env.HOME!,
  "Development/bloomreach/campaign-studio/src/lib/data/alza-products.raw.json"
);
const CHECKPOINT_EVERY = 100;
const TARGET_PRODUCTS = 2200;
const PER_CATEGORY_CAP = 400; // avoid one deep category (e.g. a promo bucket) dominating the catalog
const MAX_PAGES_PER_CATEGORY = 110; // narrower scope -> click "load more" much deeper per category
const MAX_TILE_DEPTH = 3; // recurse into hub pages up to this many levels
const MOBILE_DEPARTMENT_ID = 18890259; // "Mobily, chytré hodinky, tablety"
const MOBILE_DEPARTMENT_NAME = "Mobily, chytré hodinky, tablety";

const CARD_EXTRACTOR = `(function() {
  return Array.from(document.querySelectorAll('.browsingitem')).map(function(card) {
    function txt(sel) {
      var el = card.querySelector(sel);
      return el ? el.textContent.trim().replace(/\\s+/g, ' ') : null;
    }
    function attr(sel, a) {
      var el = card.querySelector(sel);
      return el ? el.getAttribute(a) : null;
    }
    var sample = (card.textContent || '').trim().replace(/\\s+/g, ' ');
    var ratingMatch = sample.match(/(\\d[,.]\\d)\\s*\\d+×/);
    var reviewMatch = sample.match(/(\\d+)×/);
    return {
      code: card.getAttribute('data-code'),
      id: card.getAttribute('data-id'),
      sponsored: !!card.querySelector('.box-recommendation'),
      name: txt('a.name') || txt('.name'),
      url: attr('a.name', 'href') || attr('a[href*=".htm"]', 'href'),
      image: attr('img', 'src') || attr('img', 'data-src'),
      priceText: txt('.price'),
      ratingText: ratingMatch ? ratingMatch[1] : null,
      reviewCountText: reviewMatch ? reviewMatch[1] : null
    };
  });
})()`;

const TILE_EXTRACTOR = `(function() {
  return Array.from(document.querySelectorAll('.react-category-tiles a[href*=".htm"]')).map(function(a) {
    return { href: a.getAttribute('href'), text: (a.textContent || '').trim().replace(/\\s+/g, ' ') };
  });
})()`;

interface RawCard {
  code: string | null;
  id: string | null;
  sponsored: boolean;
  name: string | null;
  url: string | null;
  image: string | null;
  priceText: string | null;
  ratingText: string | null;
  reviewCountText: string | null;
}

interface RawProduct {
  code: string;
  name: string;
  url: string;
  image: string | null;
  price: number | null;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  category: string;
}

function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d[\d\s]{1,7})\s*,-/);
  if (!m) return null;
  const cleaned = (m[1] ?? "").replace(/\s+/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = new AlzaBrowser({ baseUrl: "https://www.alza.cz" });

  const seen = new Map<string, RawProduct>();

  function loadCheckpoint() {
    if (fs.existsSync(OUT_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(OUT_PATH, "utf8")) as RawProduct[];
        for (const p of data) seen.set(p.code, p);
        console.log(`Loaded checkpoint: ${seen.size} products`);
      } catch {
        // ignore
      }
    }
  }

  function saveCheckpoint() {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(Array.from(seen.values()), null, 2));
    console.log(`Checkpoint saved: ${seen.size} products`);
  }

  loadCheckpoint();

  // ---- Discover the full leaf-category tree under the Mobily department. ----
  const visitedCatIds = new Set<number>([MOBILE_DEPARTMENT_ID]);
  const leafCategories: { id: number; name: string }[] = [];

  interface QueueItem {
    id: number;
    name: string;
    depth: number;
  }
  const queue: QueueItem[] = [{ id: MOBILE_DEPARTMENT_ID, name: MOBILE_DEPARTMENT_NAME, depth: 0 }];

  console.log(`Discovering category tree under department ${MOBILE_DEPARTMENT_ID} ${MOBILE_DEPARTMENT_NAME}...`);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    try {
      const url = `${browser.baseUrl}/${cur.id}.htm`;
      let hasCards = 0;
      let tiles: Array<{ href: string | null; text: string }> = [];
      // The very first navigation after a fresh Chromium launch occasionally
      // races ahead of full page render (0 cards, 0 tiles) — retry once.
      for (let attempt = 1; attempt <= 3; attempt++) {
        const result = await browser.withPage(async (p) => {
          await p.goto(url, { waitUntil: "commit", timeout: 30_000 });
          await p.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
          await p.waitForTimeout(attempt === 1 ? 800 : 1800);
          const hc = (await p.evaluate(`document.querySelectorAll('.browsingitem').length`)) as number;
          const tl = (await p.evaluate(TILE_EXTRACTOR)) as Array<{ href: string | null; text: string }>;
          return { hasCards: hc, tiles: tl };
        });
        hasCards = result.hasCards;
        tiles = result.tiles;
        if (hasCards > 0 || tiles.length > 0) break;
        if (attempt < 3) {
          console.log(`  (retry ${attempt}: 0 cards, 0 tiles for ${cur.id} ${cur.name})`);
          await sleep(1000);
        }
      }

      if (hasCards > 0) {
        leafCategories.push({ id: cur.id, name: cur.name });
        console.log(`  LEAF  ${cur.id} ${cur.name} (${hasCards} cards on pg1)`);
      } else {
        console.log(`  HUB   ${cur.id} ${cur.name} (0 cards, ${tiles.length} tiles)`);
      }

      if (cur.depth < MAX_TILE_DEPTH) {
        for (const t of tiles) {
          if (!t.href || !t.text) continue;
          const m = t.href.match(/\/(\d{4,})\.htm$/);
          if (!m) continue;
          const id = Number(m[1]);
          if (visitedCatIds.has(id)) continue;
          visitedCatIds.add(id);
          queue.push({ id, name: t.text, depth: cur.depth + 1 });
        }
      }
    } catch (e) {
      console.log(`  ERROR ${cur.id} ${cur.name}: ${(e as Error).message}`);
    }
    await sleep(400);
  }

  console.log(`\nDiscovered ${leafCategories.length} leaf categories under the Mobily department.`);
  leafCategories.forEach((c) => console.log(`  ${c.id} ${c.name}`));

  // Promo / curated-bundle style tiles (seasonal picks, single-model launch
  // pages, brand "novinky" pages) tend to have deceptively deep inventory
  // behind their "load more" button and would otherwise dominate the whole
  // catalog under a marketing-sounding category name. Scrape genuine
  // product-line categories first so the catalog stays diverse across
  // phones / tablets / wearables / accessories, and only fall back to the
  // promo buckets to top up toward the target at the end.
  const PROMO_NAME_RE = /léto|pixel|novinky|iphone|galaxy/i;
  const orderedCategories = [
    ...leafCategories.filter((c) => !PROMO_NAME_RE.test(c.name)),
    ...leafCategories.filter((c) => PROMO_NAME_RE.test(c.name)),
  ];

  // ---- Scrape products from each leaf category, paginating deep. ----
  let sinceCheckpoint = 0;

  for (const cat of orderedCategories) {
    if (seen.size >= TARGET_PRODUCTS) {
      console.log("Target reached, stopping category loop.");
      break;
    }
    const beforeCount = seen.size;
    console.log(`\n=== Category ${cat.id} ${cat.name} (have ${seen.size}) ===`);
    // Alza's category listing pages don't paginate via ?pg=n — they render
    // the first 24 items and grow the grid in place via a "24 dalších..."
    // (load more) button (class js-button-more). Use a single persistent
    // page per category: load once, then click that button repeatedly,
    // re-extracting the (growing) card list after each click.
    const url = `${browser.baseUrl}/${cat.id}.htm`;
    try {
      await browser.withPage(async (p) => {
        await p.goto(url, { waitUntil: "commit", timeout: 30_000 });
        await p.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
        await p.waitForSelector(".browsingitem", { timeout: 10_000 }).catch(() => null);

        let stagnantRounds = 0;
        for (let round = 1; round <= MAX_PAGES_PER_CATEGORY; round++) {
          const cards = (await p.evaluate(CARD_EXTRACTOR)) as RawCard[];
          const real = cards.filter((c) => !c.sponsored && c.code && c.name && c.url);

          let added = 0;
          for (const c of real) {
            if (seen.has(c.code!)) continue;
            seen.set(c.code!, {
              code: c.code!,
              name: c.name!,
              url: c.url!.startsWith("http") ? c.url! : new URL(c.url!, browser.baseUrl).toString(),
              image: c.image,
              price: parsePrice(c.priceText),
              currency: "CZK",
              rating: c.ratingText ? Number(c.ratingText.replace(",", ".")) : null,
              reviewCount: c.reviewCountText ? Number(c.reviewCountText) : null,
              category: cat.name,
            });
            added++;
          }
          console.log(`  round${round}: ${real.length} cards on page, +${added} new (total ${seen.size})`);
          sinceCheckpoint += added;
          if (sinceCheckpoint >= CHECKPOINT_EVERY) {
            saveCheckpoint();
            sinceCheckpoint = 0;
          }

          if (added === 0) {
            stagnantRounds++;
            if (stagnantRounds >= 2) {
              console.log(`  round${round}: no new products for 2 rounds, stopping category`);
              break;
            }
          } else {
            stagnantRounds = 0;
          }

          if (seen.size >= TARGET_PRODUCTS) break;
          if (seen.size - beforeCount >= PER_CATEGORY_CAP) {
            console.log(`  round${round}: per-category cap (${PER_CATEGORY_CAP}) reached, moving on`);
            break;
          }

          const clicked = await p.evaluate(() => {
            const btn = document.querySelector(".js-button-more") as HTMLElement | null;
            if (btn) {
              btn.scrollIntoView();
              btn.click();
              return true;
            }
            return false;
          });
          if (!clicked) {
            console.log(`  round${round}: no "load more" button, stopping category`);
            break;
          }
          await p.waitForTimeout(1200 + Math.random() * 500);
        }
      });
    } catch (e) {
      console.log(`  error scraping category: ${(e as Error).message}`);
    }
    await sleep(500 + Math.random() * 400);
  }

  saveCheckpoint();
  await browser.close();
  console.log(`\nDONE. Total unique products: ${seen.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
