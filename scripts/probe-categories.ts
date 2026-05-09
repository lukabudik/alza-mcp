#!/usr/bin/env tsx
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "cs-CZ",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  });
  await context.route("**/*", (r) => {
    const t = r.request().resourceType();
    if (t === "image" || t === "media" || t === "font") return r.abort();
    return r.continue();
  });
  const page = await context.newPage();

  await page.goto("https://www.alza.cz/", { waitUntil: "commit", timeout: 30_000 });
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});

  // Hover on the main "Kategorie" trigger if present, otherwise just inspect
  // every anchor in the top half of the page.
  const candidates = (await page.evaluate(`(function() {
    var out = [];
    var anchors = document.querySelectorAll('a[href*=".htm"]');
    for (var i = 0; i < anchors.length && out.length < 200; i++) {
      var a = anchors[i];
      var href = a.getAttribute('href') || '';
      var name = (a.textContent || '').trim().replace(/\\s+/g, ' ');
      var idMatch = href.match(/(\\d{4,})\\.htm/);
      if (!idMatch || !name || name.length > 60) continue;
      var rect = a.getBoundingClientRect();
      out.push({
        id: parseInt(idMatch[1], 10),
        name: name,
        href: href,
        cls: (a.className || '').slice(0, 80),
        parent: (a.parentElement && a.parentElement.tagName) || null,
        ancestorCls: (function() {
          var p = a;
          var classes = [];
          for (var k = 0; k < 5 && p; k++) {
            classes.push(p.tagName + (p.className ? '.' + (p.className+'').replace(/\\s+/g, '.').slice(0,40) : ''));
            p = p.parentElement;
          }
          return classes.join(' > ');
        })(),
        topY: Math.round(rect.top + window.scrollY)
      });
    }
    return out;
  })()`)) as Array<{ id: number; name: string; href: string; cls: string; ancestorCls: string; topY: number }>;

  // Group by ancestor pattern.
  const groups = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const list = groups.get(c.ancestorCls.slice(0, 80)) ?? [];
    list.push(c);
    groups.set(c.ancestorCls.slice(0, 80), list);
  }
  const sorted = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of sorted.slice(0, 8)) {
    console.log(`\n=== ancestor: ${k}  (count: ${v.length})`);
    for (const item of v.slice(0, 6)) {
      console.log(`  ${item.id.toString().padEnd(8)} ${item.name.padEnd(40)} ${item.cls}`);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
