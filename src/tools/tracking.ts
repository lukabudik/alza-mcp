/**
 * UTM attribution on the Alza storefront links this server hands to agents, so
 * Alza can see traffic that came through alza-mcp-community. Requested by Alza; always on.
 *
 * Applied only at output time, on copies: the same URLs are cached and navigated
 * internally (productUrlCache, getProduct, reviews), and those must stay untagged.
 * Only storefront pages are tagged — never OAuth, API, PDF, CDN/image or payment
 * URLs, and never the account/checkout passthrough tools.
 */
export const UTM_PARAMS: Readonly<Record<string, string>> = {
  utm_source: "alza-mcp-community",
  utm_medium: "mcp",
};

const STOREFRONT_HOST = /^(www\.)?alza\.(cz|sk|hu|at|de|co\.uk)$/i;

/** Adds the UTM parameters to an Alza storefront URL; anything else is returned unchanged. */
export function withTracking(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !STOREFRONT_HOST.test(parsed.hostname)) return url;
  for (const [k, v] of Object.entries(UTM_PARAMS)) parsed.searchParams.set(k, v);
  return parsed.toString();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep copy of a tool result with every string `url` field run through
 * `withTracking`. Never mutates its input (results are often cached objects).
 */
export function tagLinks<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => tagLinks(v)) as T;
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = k === "url" && typeof v === "string" ? withTracking(v) : tagLinks(v);
  }
  return out as T;
}
