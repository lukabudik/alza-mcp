import type { AlzaBrowser } from "../infra/browser.js";
import { TtlCache } from "../infra/cache.js";
import { NotFoundError } from "../infra/errors.js";
import { extractJsonLd, findProduct as findJsonLdProduct } from "../infra/jsonld.js";
import { log } from "../infra/logger.js";
import type { Category, FacetGroup, Product, ProductParam, SearchResult } from "./types.js";

export type SortOrder = "relevance" | "price-asc" | "price-desc" | "rating" | "newest";

export interface SearchOptions {
  query: string;
  limit?: number;
  page?: number;
  sort?: SortOrder;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  categoryId?: number;
  minScreenInches?: number;
  maxScreenInches?: number;
  /** Alza producer/brand ids (from `list_category_filters`'s `producers` group). Requires `categoryId`. */
  producerIds?: number[];
  /** Checkbox-type attribute facet selections (from `list_category_filters`, `filterable: true` groups only). Requires `categoryId`. */
  filters?: Array<{ paramId: number; valueId: number }>;
}

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
  /**
   * Purchasable right now, per the card's CTA (verified 2026-09-12):
   * true = "Do košíku" / "Vybrat variantu" button, false = "Hlídat" (watch)
   * button, null = no CTA found (undetermined). Alza search cards carry no
   * explicit stock attribute.
   */
  inStock: boolean | null;
}

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
    // Stock signal = the purchase CTA (verified 2026-09-12): "Do košíku" /
    // "Vybrat variantu" = purchasable now, a standalone "Hlídat" button = not
    // purchasable. The "Hlídat dostupnost nebo cenu" watch link appears on
    // every card, so only exact CTA texts are trusted.
    var inStock = null;
    var ctas = Array.from(card.querySelectorAll('a, button')).map(function(e) { return (e.textContent || '').replace(/\\u00a0/g, ' ').trim(); });
    if (ctas.some(function(t) { return /Do košíku|Vybrat variantu/.test(t); })) inStock = true;
    else if (ctas.some(function(t) { return t === 'Hlídat'; })) inStock = false;
    return {
      code: card.getAttribute('data-code'),
      id: card.getAttribute('data-id'),
      sponsored: !!card.querySelector('.box-recommendation'),
      name: txt('a.name') || txt('.name'),
      url: attr('a.name', 'href') || attr('a[href*=".htm"]', 'href'),
      image: attr('img', 'src') || attr('img', 'data-src'),
      priceText: txt('.price'),
      ratingText: ratingMatch ? ratingMatch[1] : null,
      reviewCountText: reviewMatch ? reviewMatch[1] : null,
      inStock: inStock
    };
  });
})()`;

/**
 * Pagination links for a free-text search. Alza renders page-number anchors
 * that point at category-style pages (e.g. /notebooky/18842920-p2.htm);
 * the `pg=` query parameter on search.htm is IGNORED (verified 2026-09-14:
 * pg=2/3 repeat page 1 exactly, with or without `o=`). We therefore follow
 * the rendered links. Returns {} when the search has no pagination.
 */
const PAGE_URLS_EXTRACTOR = `(function() {
  var anchors = Array.from(document.querySelectorAll('a[href*=".htm"]'));
  var out = {};
  for (var i = 0; i < anchors.length; i++) {
    var text = (anchors[i].textContent || '').replace(/\\s+/g, ' ').trim();
    var href = anchors[i].getAttribute('href') || '';
    var m = href.match(/-p(\\d{1,3})\\.htm$/);
    if (!m) continue;
    var n = parseInt(m[1], 10);
    if (n < 2 || n > 50) continue;
    if (!/^\\d+$/.test(text) || parseInt(text, 10) !== n) continue;
    out[String(n)] = href;
  }
  if (Object.keys(out).length === 0) return out;
  // derive page 1 from the -pN pattern: ".../18842920-p2.htm" -> ".../18842920.htm"
  out["1"] = Object.values(out)[0].replace(/-p\\d+\\.htm$/, '.htm');
  return out;
})()`;

const PRODUCT_PAGE_EXTRACTOR = `(function() {
  var lds = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s) {
    try { return JSON.parse(s.textContent || '{}'); } catch (e) { return null; }
  }).filter(Boolean);
  function findType(t) {
    for (var i = 0; i < lds.length; i++) {
      var b = lds[i];
      if (!b) continue;
      var bt = b['@type'];
      if (bt === t) return b;
      if (Array.isArray(bt) && bt.indexOf(t) >= 0) return b;
      if (b['@graph']) {
        for (var j = 0; j < b['@graph'].length; j++) {
          var g = b['@graph'][j];
          if (g && (g['@type'] === t || (Array.isArray(g['@type']) && g['@type'].indexOf(t) >= 0))) return g;
        }
      }
    }
    return null;
  }
  return {
    title: document.title,
    url: location.href,
    h1: (document.querySelector('h1') || {}).textContent || null,
    product: findType('Product'),
    breadcrumb: findType('BreadcrumbList'),
    params: Array.from(document.querySelectorAll('.paramTbl tr, table.paramTbl tr, .productSpecBox tr')).slice(0, 30).map(function(tr) {
      var th = tr.querySelector('th'), td = tr.querySelector('td');
      return { name: th ? th.textContent.trim().replace(/\\s+/g,' ') : '', value: td ? td.textContent.trim().replace(/\\s+/g,' ') : '' };
    }).filter(function(p) { return p.name && p.value; })
  };
})()`;

export class Catalog {
  private readonly searchCache = new TtlCache<string, SearchResult>(60 * 1000);
  private readonly productCache = new TtlCache<string, Product>(15 * 60 * 1000);
  private readonly productUrlCache = new TtlCache<string, string>(60 * 60 * 1000);
  private readonly categoryCache = new TtlCache<number, Category[]>(24 * 60 * 60 * 1000);

  constructor(private readonly browser: AlzaBrowser) {}

  async searchProducts(opts: SearchOptions): Promise<SearchResult> {
    const hasAttrFilters = (opts.producerIds && opts.producerIds.length > 0) || (opts.filters && opts.filters.length > 0);
    if (hasAttrFilters && !opts.categoryId) {
      throw new Error("producer_ids/filters require category_id (attribute facets are category-scoped in Alza's system) — get category_id from list_categories, then call list_category_filters to discover valid filter values");
    }
    const limit = clamp(opts.limit ?? 20, 1, 50);
    const page = Math.max(1, opts.page ?? 1);
    const cacheKey = JSON.stringify({ ...opts, limit, page });

    // Alza's search page ignores server-side sort (verified 2026-09-12) and
    // cards carry no explicit stock attribute, so for price/rating orders we
    // gather candidates from up to sortSweepPages(limit) pages and sort
    // client-side (compareForSort); `in_stock` is enforced from each card's
    // purchase CTA (see RawCard.inStock). An explicit page > 1 keeps the
    // single-page behaviour.
    const sweeping =
      page === 1 &&
      (opts.sort === "price-asc" || opts.sort === "price-desc" || opts.sort === "rating");
    const maxPages = sweeping ? sortSweepPages(limit) : 1;

    return this.searchCache.memoize(cacheKey, async () => {
      const candidates: Product[] = [];
      const seen = new Set<string>();
      let pagesFetched = 0;
      // Pagination links resolved from the rendered page-number anchors (see
      // PAGE_URLS_EXTRACTOR); search.htm?pg=N is ignored by Alza.
      let pageLinks: Record<string, string> = {};
      for (let n = 1; n < page + maxPages; n++) {
        if (n < page) continue; // explicit page: skip earlier pages
        let target = pageLinks[String(n)];
        if (!target && n > 1) {
          // Resolve links via the first page (one navigation), then continue.
          const first = await this.fetchSearchPage(opts);
          pagesFetched++;
          pageLinks = { ...pageLinks, ...first.pageUrls };
          target = pageLinks[String(n)];
          if (!target) break; // Alza rendered no such page — be honest, don't guess
        }
        const { cards, pageUrls } = await this.fetchSearchPage(opts, target);
        pagesFetched++;
        pageLinks = { ...pageLinks, ...pageUrls };
        const organic = cards
          .filter((c) => !c.sponsored)
          .map((c) => this.normalizeCard(c))
          .filter((p): p is Product => p !== null);
        for (const p of organic) {
          if (seen.has(p.code)) continue;
          seen.add(p.code);
          candidates.push(p);
          this.productUrlCache.set(p.code, p.url);
        }
        // Ran past the end of the results (empty/short page) — no point more.
        if (!sweeping || organic.length === 0) break;
      }

      const products = candidates
        .filter((p) => filterByPrice(p, opts))
        .filter((p) => passesInStock(p, opts.inStock))
        .filter((p) => filterByScreenSize(p, opts))
        .sort((a, b) => compareForSort(a, b, opts.sort))
        .slice(0, limit);

      log.debug("catalog.searchProducts", {
        query: opts.query,
        pages: pagesFetched,
        candidates: candidates.length,
        returned: products.length,
      });

      return {
        query: opts.query,
        total: products.length,
        page,
        pageSize: limit,
        candidatesScanned: candidates.length,
        products,
      };
    });
  }

  private async fetchSearchPage(
    opts: SearchOptions,
    explicitUrl?: string
  ): Promise<{ cards: RawCard[]; pageUrls: Record<string, string> }> {
    const url = explicitUrl ? this.absUrl(explicitUrl) : this.buildSearchUrl(opts, 1);
    log.debug("catalog.fetchSearchPage", { url });
    return this.browser.withPage(async (p) => {
      const res = await p.goto(url, { waitUntil: "commit", timeout: 30_000 });
      await p.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
      if (res && res.status() >= 400) {
        // Some "no results" pages are legit 404 — degrade gracefully.
        return { cards: [] as RawCard[], pageUrls: {} };
      }
      // Render-race guard (observed 2026-09-12): the first navigation after a
      // cold browser launch can finish "load" with the result grid still
      // unrendered, and the selector wait can expire with zero cards —
      // reporting "No products found" for a query that does have results.
      // Retry the extraction a bounded number of times before accepting an
      // empty grid (a genuinely empty result costs ~30 s extra; a false
      // empty is much worse).
      let cards = [] as RawCard[];
      for (let attempt = 0; ; attempt++) {
        await p.waitForSelector(".browsingitem", { timeout: 10_000 }).catch(() => null);
        cards = (await p.evaluate(CARD_EXTRACTOR)) as RawCard[];
        log.debug("catalog.fetchSearchPage.cards", {
          url,
          attempt,
          cards: cards.length,
          sponsored: cards.filter((c) => c.sponsored).length,
          incomplete: cards.filter((c) => !c.code || !c.name || !c.url).length,
        });
        if (cards.length > 0 || attempt >= 2) break;
        await p.waitForTimeout(2_000);
      }
      const pageUrls = (await p.evaluate(PAGE_URLS_EXTRACTOR)) as Record<string, string>;
      return { cards, pageUrls };
    });
  }

  async getProduct(code: string): Promise<Product> {
    const trimmed = code.trim();
    if (!trimmed) throw new NotFoundError("product code");

    return this.productCache.memoize(trimmed, async () => {
      const url = await this.resolveProductUrl(trimmed);
      log.debug("catalog.getProduct", { code: trimmed, url });

      const data = await this.browser.withPage(async (p) => {
        await p.goto(url, { waitUntil: "commit", timeout: 30_000 });
        await p.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
        return (await p.evaluate(PRODUCT_PAGE_EXTRACTOR)) as ProductPageData;
      });

      const ld = data.product;
      if (!ld) throw new NotFoundError(`product ${trimmed}`);

      const name = (ld.name as string) ?? data.h1 ?? trimmed;
      const offers = pickOffer(ld.offers);
      const rating = pickRating(ld.aggregateRating);
      const breadcrumbs = pickBreadcrumbs(data.breadcrumb);
      const images = pickImages(ld.image);

      // Merge both spec sources — some page templates only populate one
      // (live-verified 2026-09-27: the DOM .paramTbl table is sometimes
      // entirely absent while additionalProperty carries the real specs).
      // DOM-table rows win on name collisions; extra additionalProperty
      // rows are appended, capped at 30 total to match the DOM-only cap.
      const seenNames = new Set(data.params.map((p) => p.name));
      const extraParams = pickAdditionalProperties(ld.additionalProperty).filter((p) => !seenNames.has(p.name));
      const mergedParams = [...data.params, ...extraParams].slice(0, 30);

      return {
        code: ((ld.sku as string) ?? trimmed).trim(),
        id: 0,
        name: stripHtmlEntities(name),
        url: data.url,
        image: images[0],
        price: offers.price,
        currency: offers.priceCurrency ?? this.browser.locale.currency,
        availability: offers.availability,
        rating: rating.average,
        brand: pickBrand(ld.brand),
        category: breadcrumbs[breadcrumbs.length - 2],
        params: mergedParams.length > 0 ? mergedParams : undefined,
      };
    });
  }

  private readonly facetsCache = new TtlCache<number, FacetGroup[]>(60 * 60 * 1000);

  /**
   * Category attribute facets (brand, native contrast, panel type, screen
   * diagonal, …) from the live JSON facets API. Read-only, same-origin
   * fetch from within a loaded page (this endpoint sits behind the same
   * Cloudflare wall as everything else; a real browser page already
   * cleared it). Only `renderType: "Checkbox"` groups are `filterable` —
   * see `buildFilteredCategoryUrl`'s docstring for why Slider-type facets
   * aren't.
   */
  async getFacets(categoryId: number): Promise<FacetGroup[]> {
    return this.facetsCache.memoize(categoryId, async () => {
      const pageUrl = `${this.browser.locale.baseUrl}/${categoryId}.htm`;
      const apiUrl = `/services/restservice.svc/v3/params/${categoryId}?type=CATEGORY&typeId=0&search=`;
      return this.browser.withPage(async (p) => {
        await p.goto(pageUrl, { waitUntil: "commit", timeout: 30_000 });
        await p.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
        const raw = (await p.evaluate(
          `fetch(${JSON.stringify(apiUrl)}, { headers: { accept: "application/json" } }).then((r) => r.json())`
        )) as FacetsApiResponse;
        return parseFacetsResponse(raw);
      });
    });
  }

  async listCategories(parentId?: number): Promise<Category[]> {
    return this.categoryCache.memoize(parentId ?? 0, async () => {
      const url = parentId
        ? `${this.browser.locale.baseUrl}/${parentId}.htm`
        : this.browser.locale.baseUrl;

      return this.browser.withPage(async (p) => {
        await p.goto(url, { waitUntil: "commit", timeout: 30_000 });
        await p.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});

        const raw = (await p.evaluate(`(function() {
          // Top-level: Alza homepage uses MUI list items with class
          // 'category-navigation-item'. Sub-level: same pattern works
          // on category pages, with sidebar links also marked similarly.
          var sels = [
            'li[class*="category-naviga"] a[href*=".htm"]',
            '.subCategoriesList a[href*=".htm"]',
            '.category-tree a[href*=".htm"]',
            'ul.subCategories a[href*=".htm"]'
          ];
          var seen = new Set();
          var out = [];
          for (var s = 0; s < sels.length; s++) {
            var els = document.querySelectorAll(sels[s]);
            for (var i = 0; i < els.length; i++) {
              var a = els[i];
              var href = a.getAttribute('href') || '';
              var idMatch = href.match(/(\\d{4,})\\.htm/);
              var name = (a.textContent || '').trim().replace(/\\s+/g, ' ');
              if (!idMatch || !name || name.length > 80) continue;
              // Skip promo/seasonal entries that appear at the top of the menu.
              if (/^Alza dny/i.test(name)) continue;
              var id = parseInt(idMatch[1], 10);
              if (seen.has(id)) continue;
              seen.add(id);
              out.push({ id: id, name: name, url: href });
            }
            if (out.length > 0) break;
          }
          return out;
        })()`)) as Array<{ id: number; name: string; url: string }>;

        return raw
          .map((c) => ({
            id: c.id,
            name: stripHtmlEntities(c.name),
            url: this.absUrl(c.url),
          }))
          .slice(0, 60);
      });
    });
  }

  async resolveProductUrl(code: string): Promise<string> {
    const cached = this.productUrlCache.get(code);
    if (cached) return cached;

    // Search by code, expect first matching card.
    const searchUrl = this.buildSearchUrl({ query: code }, 1);
    const found = await this.browser.withPage(async (p) => {
      await p.goto(searchUrl, { waitUntil: "commit", timeout: 30_000 });
      await p.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
      await p.waitForSelector(".browsingitem", { timeout: 12_000 }).catch(() => null);
      return (await p.evaluate(`(function() {
        var cards = Array.from(document.querySelectorAll('.browsingitem'));
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i];
          var dc = (c.getAttribute('data-code') || '').toLowerCase();
          if (dc !== ${JSON.stringify(code.toLowerCase())}) continue;
          var a = c.querySelector('a.name') || c.querySelector('a[href*=".htm"]');
          if (a && a.href) return a.href;
        }
        return null;
      })()`)) as string | null;
    });

    if (!found) throw new NotFoundError(`product ${code}`);
    this.productUrlCache.set(code, found);
    return found;
  }

  private buildSearchUrl(opts: SearchOptions, page: number): string {
    const hasAttrFilters = (opts.producerIds && opts.producerIds.length > 0) || (opts.filters && opts.filters.length > 0);
    if (hasAttrFilters && opts.categoryId) {
      // Category+attribute-filter browse page (live-verified 2026-09-27):
      // the URL's slug segments are cosmetic (any text, or none, resolves
      // to the canonical page) — only the numeric `{categoryId}[-v{producerId}]
      // [-par{paramId}-{valueId}]...` suffix matters. Real pagination for
      // this path still comes from the rendered page-link anchors (same as
      // /search.htm), not a query parameter.
      return buildFilteredCategoryUrl(this.browser.locale.baseUrl, opts.categoryId, opts.producerIds, opts.filters);
    }
    const url = new URL("/search.htm", this.browser.locale.baseUrl);
    url.searchParams.set("exps", opts.query);
    if (opts.sort) {
      // NOTE: Alza's /search.htm currently ignores the `o=` sort parameter
      // (verified 2026-09-12: o=0/2/3 all return identical relevance order;
      // the site's sort control is client-side JS). We keep the parameter as
      // documentation of intent and rely on `compareForSort` below, which
      // sorts the fetched page client-side — that is the actual guarantee.
      const sortMap: Record<SortOrder, string> = {
        relevance: "0",
        "price-asc": "2",
        "price-desc": "3",
        rating: "8",
        newest: "9",
      };
      url.searchParams.set("o", sortMap[opts.sort] ?? "0");
    }
    if (page > 1) url.searchParams.set("pg", String(page));
    if (opts.categoryId) url.searchParams.set("idc", String(opts.categoryId));
    return url.toString();
  }

  private normalizeCard(c: RawCard): Product | null {
    if (!c.code || !c.name || !c.url) return null;
    return {
      code: c.code,
      id: c.id ? Number(c.id) : 0,
      name: c.name,
      url: this.absUrl(c.url),
      image: c.image ?? undefined,
      price: parsePrice(c.priceText),
      currency: this.browser.locale.currency,
      availability:
        c.inStock === null ? undefined : c.inStock ? "in stock" : "not purchasable now",
      rating: c.ratingText ? Number(c.ratingText.replace(",", ".")) : undefined,
    };
  }

  private absUrl(url: string): string {
    if (url.startsWith("http")) return url;
    return new URL(url, this.browser.locale.baseUrl).toString();
  }
}

interface ProductPageData {
  title: string;
  url: string;
  h1: string | null;
  product: Record<string, unknown> | null;
  breadcrumb: Record<string, unknown> | null;
  params: Array<{ name: string; value: string }>;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * How many result pages to gather before a client-side price/rating sort.
 * Alza serves ~24 cards per page (verified 2026-09-12). Two pages (~48
 * candidates) is the floor so the sort has real material; three pages (~72)
 * covers the largest limit. Bounded for latency: each page is one full
 * browser navigation.
 */
export function sortSweepPages(limit: number): number {
  return Math.min(3, Math.max(2, Math.ceil(limit / 24)));
}

/**
 * In-stock filter from the card's purchase CTA. `inStock: true` keeps only
 * products confirmed purchasable now; undetermined stock is excluded (the
 * flag is an assertion). Without the flag nothing is filtered.
 */
export function passesInStock(p: Product, inStock?: boolean): boolean {
  if (!inStock) return true;
  return p.availability === "in stock";
}

/**
 * Client-side sort for search results. Alza's search page serves results in
 * relevance order regardless of the `o=` parameter, so price/rating orders
 * are applied here — to the swept candidate pool for price/rating orders
 * (see sortSweepPages), never to the whole catalog. Products without a
 * price sort last for price orders; missing ratings sort last for rating order.
 */
export function compareForSort(a: Product, b: Product, sort?: SortOrder): number {
  if (sort === "price-asc" || sort === "price-desc") {
    if (a.price === undefined && b.price === undefined) return 0;
    if (a.price === undefined) return 1; // unknown price sorts last
    if (b.price === undefined) return -1;
    return sort === "price-asc" ? a.price - b.price : b.price - a.price;
  }
  if (sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
  return 0;
}

function filterByPrice(p: Product, opts: SearchOptions): boolean {
  if (opts.minPrice !== undefined && (p.price ?? Infinity) < opts.minPrice) return false;
  if (opts.maxPrice !== undefined && (p.price ?? -Infinity) > opts.maxPrice) return false;
  return true;
}

/**
 * Category browse URL with brand/attribute filters applied — live-verified
 * 2026-09-27 against real Alza category pages (monitor category, HDMI +
 * brand combined: product codes and page title both changed correctly).
 * The path's slug segments are purely cosmetic (any text, or none, 302s/
 * resolves to the canonical URL) — only the numeric suffix matters:
 * `{categoryId}[-v{producerId}]...[-par{paramId}-{valueId}]...`. Only
 * Checkbox-type facets (see `FacetGroup.filterable`) work this way; Slider
 * facets (size, refresh rate, weight, …) have no known URL/API encoding.
 */
interface FacetsApiResponse {
  params?: Array<{
    groups?: Array<{
      params?: Array<{
        tId?: number;
        name?: string;
        renderType?: string;
        values?: Array<{ v?: number; desc?: string; cnt?: number }>;
      }>;
    }>;
  }>;
}

/**
 * Flattens the facets API's `params[].groups[].params[]` nesting into a
 * flat list, and drops values whose `v`/`desc` didn't parse (the JSON
 * sometimes carries decorative rows, e.g. an "id:0" `art` entry within
 * the Diagonal slider — live-verified 2026-09-27).
 */
export function parseFacetsResponse(raw: FacetsApiResponse): FacetGroup[] {
  const out: FacetGroup[] = [];
  for (const group of raw.params ?? []) {
    for (const g of group.groups ?? []) {
      for (const p of g.params ?? []) {
        if (p.tId === undefined || !p.name) continue;
        const values: FacetGroup["values"] = [];
        for (const v of p.values ?? []) {
          if (v.v === undefined || !v.desc) continue;
          values.push({ valueId: Math.trunc(v.v), description: v.desc, count: v.cnt });
        }
        out.push({
          paramId: p.tId,
          name: p.name,
          renderType: p.renderType ?? "Unknown",
          filterable: p.renderType === "Checkbox",
          values,
        });
      }
    }
  }
  return out;
}

export function buildFilteredCategoryUrl(
  baseUrl: string,
  categoryId: number,
  producerIds?: number[],
  filters?: Array<{ paramId: number; valueId: number }>
): string {
  let suffix = String(categoryId);
  for (const id of producerIds ?? []) suffix += `-v${id}`;
  for (const f of filters ?? []) suffix += `-par${f.paramId}-${f.valueId}`;
  return new URL(`/${suffix}.htm`, baseUrl).toString();
}

/**
 * Screen-diagonal size, parsed from the product name's leading `NN"` token
 * (Alza's naming convention for displays: monitors/TVs/laptops name-prefix
 * the diagonal, e.g. `40" MSI MAG401QR`). Not a real attribute filter —
 * Alza's actual diagonal facet is a client-side-only jQuery UI slider with
 * no URL/API encoding we could find (live-verified 2026-09-27: the search
 * JSON API's `params`/`producers` fields accept values without error but
 * silently don't filter; the category page's slider fires no discoverable
 * XHR/URL on change). This name-prefix heuristic is a pragmatic substitute
 * that works for the product families that actually carry a diagonal in
 * their name; see `search-products.ts`'s description for the caveat.
 */
export function parseScreenInches(name: string): number | undefined {
  const m = name.match(/^(\d+(?:[.,]\d+)?)\s*(?:"|''|″)/);
  if (!m) return undefined;
  const n = Number((m[1] ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function filterByScreenSize(p: Product, opts: SearchOptions): boolean {
  if (opts.minScreenInches === undefined && opts.maxScreenInches === undefined) return true;
  const inches = parseScreenInches(p.name);
  if (inches === undefined) return false; // can't verify => excluded, like passesInStock's undetermined case
  if (opts.minScreenInches !== undefined && inches < opts.minScreenInches) return false;
  if (opts.maxScreenInches !== undefined && inches > opts.maxScreenInches) return false;
  return true;
}

function parsePrice(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  // Alza search cards show prices like "5 290,-" or "Super cena 4 399,- Ušetříte 91,-".
  // Take the first price-shaped number.
  const m = raw.match(/(\d[\d\s]{1,7})\s*,-/);
  if (!m) return undefined;
  const cleaned = (m[1] ?? "").replace(/\s+/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function pickOffer(raw: unknown): { price?: number; priceCurrency?: string; availability?: string } {
  if (!raw || typeof raw !== "object") return {};
  const first = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;
  const price = first["price"] ?? (first["priceSpecification"] as Record<string, unknown> | undefined)?.["price"];
  return {
    price: asNumber(price),
    priceCurrency: asString(first["priceCurrency"]),
    availability: stripSchema(asString(first["availability"])),
  };
}

function pickRating(raw: unknown): { average?: number; count?: number } {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    average: asNumber(r["ratingValue"]),
    count: asNumber(r["reviewCount"] ?? r["ratingCount"]),
  };
}

function pickBrand(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") return asString((raw as Record<string, unknown>)["name"]);
  return undefined;
}

function pickImages(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) {
    return raw
      .map((i) => (typeof i === "string" ? i : asString((i as Record<string, unknown>)["url"])))
      .filter((u): u is string => !!u);
  }
  if (typeof raw === "object") {
    const u = asString((raw as Record<string, unknown>)["url"]);
    return u ? [u] : [];
  }
  return [];
}

/**
 * Product spec rows from the JSON-LD `additionalProperty` (schema.org
 * `PropertyValue[]`) array, when the product page's `Product` block carries
 * one. Some product-page templates (live-verified 2026-09-27, e.g. Mikrotik
 * CRS304-4XG-IN) render specs this way instead of — or in addition to — the
 * `.paramTbl` DOM table `PRODUCT_PAGE_EXTRACTOR` scrapes, so `getProduct`
 * merges both sources rather than relying on the DOM table alone (which
 * returned nothing at all for that product despite Alza's own page data
 * clearly listing e.g. "Počet LAN portů s rychlostí 10 Gbit": "4").
 */
export function pickAdditionalProperties(raw: unknown): ProductParam[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductParam[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = asString((entry as Record<string, unknown>)["name"]);
    const value = asString((entry as Record<string, unknown>)["value"]);
    if (name && value) out.push({ name, value });
  }
  return out;
}

function pickBreadcrumbs(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>)["itemListElement"];
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => stripHtmlEntities(asString((item as Record<string, unknown>)["name"]) ?? ""))
    .filter(Boolean);
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function stripSchema(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return v.replace(/^https?:\/\/schema\.org\//, "");
}

function stripHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z]+;/g, "");
}
