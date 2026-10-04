#!/usr/bin/env tsx
/**
 * Run every read-only catalog tool against live Alza and print pass/fail.
 * Use after major frontend updates or when MCP users report tools failing.
 * Also the daily live canary (.github/workflows/live-canary.yml).
 *
 *     npm run validate:api
 *     npm run validate:api -- --markdown summary.md   # also write the summary to a file
 *
 * Account / cart / checkout / order tools are deliberately NOT covered —
 * they act on real accounts.
 *
 * Exit codes:
 *   0  all checks passed
 *   1  at least one check failed (Alza likely changed its site)
 *   2  Cloudflare challenged this machine (no verdict on selectors)
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
  attempts: number;
  error?: string;
  sample?: unknown;
}

interface CloudflareProbe {
  blocked: boolean;
  status: number | null;
  title: string;
  /** Why we think it's (not) a challenge — shown in the summary. */
  evidence: string;
}

type Verdict = "pass" | "fail" | "cloudflare";

/** A parent category whose children include "Monitory", and the "Monitory" category itself. */
const PARENT_CATEGORY_ID = 18890188;
const MONITORS_CATEGORY_ID = 18842948;
const DELL_PRODUCER_ID = 1396;
const KNOWN_PRODUCT_QUERY = "Mikrotik CRS304";

/** A failed check is retried once — the canary should flag site changes, not network blips. */
const MAX_ATTEMPTS = 2;
const CF_PROBE_ATTEMPTS = 3;
const CF_PROBE_BACKOFF_MS = 15_000;
/** How long a managed challenge gets to clear itself before the probe calls it a block. */
const CF_SOLVE_WAIT_MS = 30_000;

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

/**
 * Load the homepage and look for Cloudflare's managed-challenge markers.
 * Kept independent of the domain classes so a selector change can never be
 * mistaken for a block (or vice versa). A managed challenge can clear itself
 * in a real browser after a few seconds (the clearance cookie then covers
 * every later page in the context), so it gets time before being judged.
 */
async function probeCloudflare(browser: AlzaBrowser): Promise<CloudflareProbe> {
  return browser.withPage(async (p) => {
    const res = await p.goto(browser.baseUrl, { waitUntil: "commit", timeout: 30_000 });
    await p.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
    const status = res?.status() ?? null;
    const mitigated = res ? await res.headerValue("cf-mitigated").catch(() => null) : null;

    const inspect = async (): Promise<{ title: string; markers: string[] }> => {
      const title = (await p.title().catch(() => "")).trim();
      const html = await p.content().catch(() => "");
      const markers = [
        // Alza's CZ challenge page: title "Okamžik…", body "Prosím, potvrďte, že jste z masa a kostí".
        /just a moment|attention required|un moment|okamžik|chvíli strpení/i.test(title) && `title "${title}"`,
        /challenges\.cloudflare\.com|cf-chl-|cf_chl_opt|cf-turnstile/i.test(html) && "challenge script in HTML",
        /Sorry, you have been blocked/i.test(html) && "\"you have been blocked\" page",
        /z masa a kostí/i.test(html) && "\"jste z masa a kostí\" human check",
      ].filter(Boolean) as string[];
      return { title, markers };
    };

    let state = await inspect();
    const challenged = mitigated === "challenge" || state.markers.length > 0;
    const deadline = Date.now() + CF_SOLVE_WAIT_MS;
    while (state.markers.length > 0 && Date.now() < deadline) {
      await p.waitForTimeout(2_000);
      state = await inspect();
    }

    const initial = `HTTP ${status ?? "?"}${mitigated === "challenge" ? " cf-mitigated: challenge" : ""}`;
    if (state.markers.length > 0) {
      return {
        blocked: true,
        status,
        title: state.title,
        evidence: `${initial}; still challenged after ${CF_SOLVE_WAIT_MS / 1000} s (${state.markers.join(", ")})`,
      };
    }
    // A 4xx/5xx that isn't a recognisable Alza page is a block even if the markers changed.
    const looksLikeAlza = /alza/i.test(state.title) && !/blocked/i.test(state.title);
    if (!challenged && !looksLikeAlza && status !== null && status >= 400) {
      return { blocked: true, status, title: state.title, evidence: `${initial}, title "${state.title}"` };
    }
    return {
      blocked: false,
      status,
      title: state.title,
      evidence: `${initial}${challenged ? ", challenge cleared itself" : ""}, title "${state.title}"`,
    };
  });
}

async function probeWithRetry(browser: AlzaBrowser): Promise<CloudflareProbe> {
  let probe: CloudflareProbe = { blocked: true, status: null, title: "", evidence: "probe never ran" };
  for (let attempt = 1; attempt <= CF_PROBE_ATTEMPTS; attempt++) {
    try {
      probe = await probeCloudflare(browser);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      probe = { blocked: true, status: null, title: "", evidence: `homepage navigation failed: ${message}` };
    }
    if (!probe.blocked) return probe;
    process.stdout.write(`… Cloudflare probe ${attempt}/${CF_PROBE_ATTEMPTS} blocked (${probe.evidence})\n`);
    if (attempt < CF_PROBE_ATTEMPTS) await new Promise((r) => setTimeout(r, CF_PROBE_BACKOFF_MS * attempt));
  }
  return probe;
}

function oneLine(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function renderMarkdown(verdict: Verdict, results: Result[], probe: CloudflareProbe, baseUrl: string): string {
  const passed = results.filter((r) => r.ok).length;
  const heading = {
    pass: `✅ Live canary: ${passed}/${results.length} checks passed`,
    fail: `❌ Live canary: ${results.length - passed}/${results.length} checks failed — Alza likely changed its site`,
    cloudflare: "⚠️ Live canary: Cloudflare blocked this runner — no verdict on selectors",
  }[verdict];
  const lines = [
    `### ${heading}`,
    "",
    `Target: ${baseUrl} · ran at ${new Date().toISOString()}`,
    `Cloudflare probe: ${probe.blocked ? "**blocked**" : "clear"} (${oneLine(probe.evidence)})`,
    "",
  ];
  if (results.length > 0) {
    lines.push("| | Check | Duration | Error |", "|---|---|---:|---|");
    for (const r of results) {
      const retried = r.attempts > 1 ? ` (${r.attempts} attempts)` : "";
      lines.push(
        `| ${r.ok ? "✅" : "❌"} | ${oneLine(r.name)} | ${(r.durationMs / 1000).toFixed(1)} s${retried} | ${
          r.error ? (r.ok ? `retried after: ${oneLine(r.error)}` : oneLine(r.error)) : ""
        } |`
      );
    }
  }
  return lines.join("\n") + "\n";
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const mdIdx = argv.indexOf("--markdown");
  const markdownPath = mdIdx >= 0 ? argv[mdIdx + 1] : undefined;

  const browser = new AlzaBrowser();
  // Domain objects memoize successful results (even incomplete ones), so a
  // retry gets fresh instances — otherwise it would just re-read the cache.
  let catalog = new Catalog(browser);
  let reviews = new Reviews(browser, catalog);
  const freshDomain = (): void => {
    catalog = new Catalog(browser);
    reviews = new Reviews(browser, catalog);
  };
  const pickup = new Pickup(browser.locale);

  let topLevelIds: number[] = [];
  const knownProductCode = async (): Promise<string> => {
    const search = await catalog.searchProducts({ query: KNOWN_PRODUCT_QUERY, limit: 1 });
    const code = search.products[0]?.code;
    assert(code, `no search hit for "${KNOWN_PRODUCT_QUERY}"`);
    return code;
  };

  const checks: Check[] = [
    {
      name: "search_products('iphone')",
      fn: async () => {
        const r = await catalog.searchProducts({ query: "iphone", limit: 3 });
        assert(r.products.length > 0, "no products");
        const p = r.products[0]!;
        assert(p.code && p.name && p.url, `incomplete card: ${JSON.stringify(p)}`);
        assert(typeof p.price === "number" && p.price > 0, `no price on first card (${p.code})`);
        return p;
      },
    },
    {
      name: "search_products('ssd', sort=price-asc)",
      fn: async () => {
        const r = await catalog.searchProducts({ query: "ssd", limit: 10, sort: "price-asc" });
        assert(r.products.length >= 3, `only ${r.products.length} products`);
        const prices = r.products.map((p) => p.price).filter((n): n is number => typeof n === "number");
        assert(prices.length >= 3, `only ${prices.length} priced products`);
        for (let i = 1; i < prices.length; i++) {
          assert(prices[i]! >= prices[i - 1]!, `not ascending: ${prices.join(", ")}`);
        }
        return { prices };
      },
    },
    {
      name: `get_product('${KNOWN_PRODUCT_QUERY}' first hit)`,
      fn: async () => {
        const p = await catalog.getProduct(await knownProductCode());
        assert(p.name, "no name");
        assert(typeof p.price === "number" && p.price > 0, "no price");
        assert(p.params && p.params.length > 0, `params empty for ${p.code} (${p.url})`);
        return { code: p.code, name: p.name, price: p.price, params: p.params.length };
      },
    },
    {
      name: "list_categories() top-level",
      fn: async () => {
        const r = await catalog.listCategories();
        assert(r.length >= 5, `only ${r.length} categories`);
        topLevelIds = r.map((c) => c.id);
        return { count: r.length, sample: r.slice(0, 3).map((c) => c.name) };
      },
    },
    {
      name: `list_categories(${PARENT_CATEGORY_ID}) sub-level`,
      fn: async () => {
        const r = await catalog.listCategories(PARENT_CATEGORY_ID);
        assert(r.length > 0, "no children");
        const names = r.map((c) => c.name);
        assert(names.some((n) => /^Monitory\b/i.test(n)), `no "Monitory" child in: ${names.slice(0, 10).join(", ")}`);
        if (topLevelIds.length > 0) {
          const overlap = r.filter((c) => topLevelIds.includes(c.id)).length;
          assert(overlap < r.length / 2, "sub-level returned the top-level list");
        }
        return { count: r.length, sample: names.slice(0, 5) };
      },
    },
    {
      name: `list_category_filters(${MONITORS_CATEGORY_ID})`,
      fn: async () => {
        const r = await catalog.getCategoryFilters(MONITORS_CATEGORY_ID);
        assert(r.brands.length > 0, "brands empty");
        assert(
          r.brands.some((b) => b.valueId === DELL_PRODUCER_ID),
          `Dell (${DELL_PRODUCER_ID}) missing from brands`
        );
        return { brands: r.brands.length, groups: r.groups.length };
      },
    },
    {
      name: `search_products(category=${MONITORS_CATEGORY_ID}, producer=Dell)`,
      fn: async () => {
        const r = await catalog.searchProducts({
          query: "",
          categoryId: MONITORS_CATEGORY_ID,
          producerIds: [DELL_PRODUCER_ID],
          limit: 10,
        });
        assert(r.products.length > 0, "no products");
        const offBrand = r.products.filter((p) => !/dell/i.test(p.name));
        assert(offBrand.length === 0, `non-Dell results: ${offBrand.map((p) => p.name).join("; ")}`);
        return { count: r.products.length, sample: r.products[0]?.name };
      },
    },
    {
      name: "get_product_reviews",
      fn: async () => {
        const r = await reviews.getProductReviews(await knownProductCode(), 3);
        assert(
          typeof r.ratingAverage === "number" || r.reviews.length > 0,
          "no rating aggregate and no review bodies"
        );
        return { average: r.ratingAverage, count: r.reviewCount, bodies: r.reviews.length };
      },
    },
    {
      name: "find_pickup_points (Praha)",
      fn: async () => {
        const points = await pickup.findPickupPoints({ postalCode: "11000", limit: 5 });
        assert(points.length > 0, "no points");
        return points[0];
      },
    },
  ];

  const results: Result[] = [];
  let probe = await probeWithRetry(browser);
  if (!probe.blocked) {
    process.stdout.write(`✓ Cloudflare probe clear (${probe.evidence})\n`);
    for (const check of checks) {
      const t0 = Date.now();
      let attempts = 0;
      let lastError = "";
      let sample: unknown;
      let ok = false;
      while (attempts < MAX_ATTEMPTS && !ok) {
        attempts++;
        if (attempts > 1) freshDomain();
        try {
          sample = await check.fn();
          ok = true;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      const durationMs = Date.now() - t0;
      if (ok) {
        // Keep the first attempt's error on a retried pass — repeated flakes are a signal too.
        results.push({ name: check.name, ok, durationMs, attempts, sample, error: attempts > 1 ? lastError : undefined });
        process.stdout.write(`✓ ${check.name} (${durationMs} ms${attempts > 1 ? `, ${attempts} attempts` : ""})\n`);
      } else {
        results.push({ name: check.name, ok, durationMs, attempts, error: lastError });
        process.stdout.write(`✗ ${check.name} — ${lastError}\n`);
      }
    }
    // Failures right after a clear probe could still be a mid-run challenge:
    // re-probe so a block is never reported as a site change.
    if (results.some((r) => !r.ok)) probe = await probeWithRetry(browser);
  }

  const failed = results.filter((r) => !r.ok).length;
  const verdict: Verdict = probe.blocked ? "cloudflare" : failed > 0 ? "fail" : "pass";
  const markdown = renderMarkdown(verdict, results, probe, browser.baseUrl);

  const fs = await import("node:fs/promises");
  await fs.writeFile(
    "validation-results.json",
    JSON.stringify({ ranAt: new Date().toISOString(), verdict, probe, results }, null, 2)
  );
  if (markdownPath) await fs.writeFile(markdownPath, markdown);

  await browser.close();

  process.stdout.write(`\n${results.length - failed}/${results.length} checks passed.\n\n${markdown}`);

  // Touch buildServer to keep the export real (silence lint).
  void buildServer;

  if (verdict === "cloudflare") process.exit(2);
  if (verdict === "fail") process.exit(1);
}

run().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
