import type { AlzaBrowser } from "../infra/browser.js";
import { TtlCache } from "../infra/cache.js";
import type { Catalog } from "./catalog.js";
import type { ProductReviews } from "./types.js";

const REVIEW_EXTRACTOR = `(function() {
  // 1. Aggregate values from JSON-LD Product (the canonical source).
  var lds = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s) {
    try { return JSON.parse(s.textContent || '{}'); } catch (e) { return null; }
  }).filter(Boolean);
  var product = null;
  for (var i = 0; i < lds.length; i++) {
    var b = lds[i];
    var t = b['@type'];
    if (t === 'Product' || (Array.isArray(t) && t.indexOf('Product') >= 0)) { product = b; break; }
    if (b['@graph']) {
      for (var j = 0; j < b['@graph'].length; j++) {
        var g = b['@graph'][j];
        if (g && (g['@type'] === 'Product' || (Array.isArray(g['@type']) && g['@type'].indexOf('Product') >= 0))) { product = g; break; }
      }
    }
    if (product) break;
  }
  var agg = product && product.aggregateRating ? product.aggregateRating : {};

  // 2. Individual review bodies live in the DOM (Alza renders them server-side).
  // Try several known selector patterns; first hit wins.
  var rootSels = [
    '.review-list .review',
    '.reviews .review',
    '.commentList .commentItem',
    '.userReview',
    '[data-review]',
    '.reviewItem'
  ];
  var reviews = [];
  for (var s = 0; s < rootSels.length; s++) {
    var nodes = document.querySelectorAll(rootSels[s]);
    if (nodes.length === 0) continue;
    for (var k = 0; k < nodes.length && k < 50; k++) {
      var n = nodes[k];
      function inner(sel) {
        var el = n.querySelector(sel);
        return el ? el.textContent.trim().replace(/\\s+/g, ' ') : null;
      }
      var ratingEl = n.querySelector('[data-rating], .rating, .stars');
      var ratingAttr = ratingEl ? ratingEl.getAttribute('data-rating') : null;
      var ratingText = inner('[data-rating]') || inner('.rating') || inner('.stars');
      var match = (ratingAttr || ratingText || '').match(/(\\d[,.]\\d?)/);
      reviews.push({
        author: inner('.author, .reviewerName, .commentAuthor, [itemprop="author"]'),
        date: inner('.date, .reviewDate, time, [itemprop="datePublished"]'),
        body: inner('.body, .reviewBody, .commentText, [itemprop="description"]') || (n.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 600),
        rating: match ? parseFloat(match[1].replace(',', '.')) : null
      });
    }
    if (reviews.length > 0) break;
  }

  return {
    average: agg.ratingValue,
    count: agg.reviewCount || agg.ratingCount,
    reviews: reviews
  };
})()`;

interface ExtractedReviews {
  average?: number;
  count?: number;
  reviews: Array<{
    author: string | null;
    date: string | null;
    body: string | null;
    rating: number | null;
  }>;
}

export class Reviews {
  private readonly cache = new TtlCache<string, ProductReviews>(15 * 60 * 1000);

  constructor(
    private readonly browser: AlzaBrowser,
    private readonly catalog: Catalog
  ) {}

  async getProductReviews(code: string, limit = 10): Promise<ProductReviews> {
    const trimmed = code.trim();
    const cap = Math.min(50, Math.max(1, limit));

    return this.cache.memoize(`${trimmed}::${cap}`, async () => {
      const url = await this.catalog.resolveProductUrl(trimmed);

      const data = await this.browser.withPage(async (p) => {
        await p.goto(url, { waitUntil: "commit", timeout: 30_000 });
        await p.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
        return (await p.evaluate(REVIEW_EXTRACTOR)) as ExtractedReviews;
      });

      return {
        code: trimmed,
        ratingAverage: data.average,
        reviewCount: data.count,
        reviews: data.reviews.slice(0, cap).map((r) => ({
          author: r.author ?? undefined,
          date: r.date ?? undefined,
          body: r.body ?? undefined,
          rating: r.rating ?? undefined,
        })),
      };
    });
  }
}
