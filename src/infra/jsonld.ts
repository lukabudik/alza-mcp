import * as cheerio from "cheerio";

export interface JsonLdOffer {
  price?: number;
  priceCurrency?: string;
  availability?: string;
  url?: string;
}

export interface JsonLdAggregateRating {
  ratingValue?: number;
  reviewCount?: number;
  bestRating?: number;
}

export interface JsonLdReview {
  author?: string;
  datePublished?: string;
  reviewRating?: { ratingValue?: number };
  reviewBody?: string;
}

export interface JsonLdProduct {
  name?: string;
  sku?: string;
  brand?: string;
  description?: string;
  image?: string | string[];
  offers?: JsonLdOffer;
  aggregateRating?: JsonLdAggregateRating;
  review?: JsonLdReview[];
}

/**
 * Extract every JSON-LD `<script>` block from an HTML page.
 * Tolerant: malformed blocks are skipped.
 */
export function extractJsonLd(html: string): unknown[] {
  const $ = cheerio.load(html);
  const out: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // Some sites embed multiple objects separated by newlines without an array.
      // Try a permissive split.
      const tries = raw.split(/}\s*{/g);
      for (let i = 0; i < tries.length; i++) {
        let chunk = tries[i] ?? "";
        if (i > 0) chunk = "{" + chunk;
        if (i < tries.length - 1) chunk = chunk + "}";
        try {
          out.push(JSON.parse(chunk));
        } catch {
          /* ignore */
        }
      }
    }
  });
  return out;
}

export function findProduct(blocks: unknown[]): JsonLdProduct | undefined {
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const t = (b as Record<string, unknown>)["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) {
      return normalizeProduct(b as Record<string, unknown>);
    }
    // Handle @graph collections.
    const graph = (b as Record<string, unknown>)["@graph"];
    if (Array.isArray(graph)) {
      const found = findProduct(graph);
      if (found) return found;
    }
  }
  return undefined;
}

function normalizeProduct(obj: Record<string, unknown>): JsonLdProduct {
  const offer = pickOffer(obj["offers"]);
  return {
    name: asString(obj["name"]),
    sku: asString(obj["sku"] ?? obj["mpn"]),
    brand: asBrand(obj["brand"]),
    description: asString(obj["description"]),
    image: obj["image"] as string | string[] | undefined,
    offers: offer,
    aggregateRating: pickAggregateRating(obj["aggregateRating"]),
    review: pickReviews(obj["review"]),
  };
}

function pickOffer(raw: unknown): JsonLdOffer | undefined {
  if (!raw) return undefined;
  // offers may be a single Offer, an AggregateOffer, or an array.
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first || typeof first !== "object") return undefined;
  const o = first as Record<string, unknown>;
  return {
    price: asNumber(o["price"] ?? o["lowPrice"]),
    priceCurrency: asString(o["priceCurrency"]),
    availability: asString(o["availability"]),
    url: asString(o["url"]),
  };
}

function pickAggregateRating(raw: unknown): JsonLdAggregateRating | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return {
    ratingValue: asNumber(r["ratingValue"]),
    reviewCount: asNumber(r["reviewCount"] ?? r["ratingCount"]),
    bestRating: asNumber(r["bestRating"]),
  };
}

function pickReviews(raw: unknown): JsonLdReview[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const obj = r as Record<string, unknown>;
      const rating = obj["reviewRating"];
      return {
        author: asAuthor(obj["author"]),
        datePublished: asString(obj["datePublished"]),
        reviewRating:
          rating && typeof rating === "object"
            ? { ratingValue: asNumber((rating as Record<string, unknown>)["ratingValue"]) }
            : undefined,
        reviewBody: asString(obj["reviewBody"] ?? obj["description"]),
      };
    });
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asBrand(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "object") return asString((v as Record<string, unknown>)["name"]);
  return undefined;
}

function asAuthor(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "object") return asString((v as Record<string, unknown>)["name"]);
  return undefined;
}
