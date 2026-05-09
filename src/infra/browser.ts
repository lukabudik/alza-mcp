import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { resolveLocale, type Locale } from "./locale.js";
import { log } from "./logger.js";

const require = createRequire(import.meta.url);

const PAGE_TIMEOUT_MS = 45_000;
const MAX_PAGES = 4;
const IDLE_PAGE_TTL_MS = 60 * 1000;
const HEADER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface BrowserOptions {
  baseUrl?: string;
  /** Connect to an existing Chrome via CDP instead of launching Chromium. */
  cdpUrl?: string;
  /** Set false to run a visible window (debugging only). Default true. */
  headless?: boolean;
}

interface PoolEntry {
  page: Page;
  inUse: boolean;
  lastUsedAt: number;
}

/**
 * Singleton-ish browser facade. The first request triggers Chromium launch
 * (or CDP attach). Pages are pooled and reused — DOM-driven scrapes become
 * "navigate + wait + extract" without paying re-launch cost per call.
 *
 * Resource discipline:
 *  - Images, media, fonts, ads, analytics are blocked at request time.
 *  - At most MAX_PAGES live pages; idle ones are recycled after IDLE_PAGE_TTL_MS.
 */
export class AlzaBrowser {
  readonly locale: Locale;
  private readonly cdpUrl?: string;
  private readonly headless: boolean;

  private launching?: Promise<Browser>;
  private browser?: Browser;
  private context?: BrowserContext;
  private readonly pool: PoolEntry[] = [];
  private closed = false;

  constructor(opts: BrowserOptions = {}) {
    this.locale = resolveLocale(opts.baseUrl);
    this.cdpUrl = opts.cdpUrl ?? process.env.ALZA_CDP_URL;
    this.headless = opts.headless ?? process.env.ALZA_HEADLESS !== "false";
  }

  /**
   * Run an async function with a fresh-or-reused page. The page is returned
   * to the pool when the callback resolves; on error it's destroyed.
   */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const entry = await this.acquirePage();
    try {
      const result = await fn(entry.page);
      entry.inUse = false;
      entry.lastUsedAt = Date.now();
      return result;
    } catch (err) {
      // Drop a faulty page rather than reusing it.
      this.dropPage(entry);
      throw err;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const entry of this.pool) {
      await entry.page.close().catch(() => {});
    }
    this.pool.length = 0;
    await this.context?.close().catch(() => {});
    if (this.cdpUrl) {
      // Don't close a browser we attached to — it belongs to the user.
      this.browser = undefined;
    } else {
      await this.browser?.close().catch(() => {});
      this.browser = undefined;
    }
  }

  private async acquirePage(): Promise<PoolEntry> {
    if (this.closed) throw new Error("browser closed");

    // Reap stale idle pages first.
    const now = Date.now();
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const e = this.pool[i];
      if (!e || e.inUse) continue;
      if (now - e.lastUsedAt > IDLE_PAGE_TTL_MS) {
        await e.page.close().catch(() => {});
        this.pool.splice(i, 1);
      }
    }

    // Reuse any idle page.
    const idle = this.pool.find((e) => !e.inUse);
    if (idle) {
      idle.inUse = true;
      return idle;
    }

    // Create a new page if under cap.
    if (this.pool.length < MAX_PAGES) {
      const ctx = await this.ensureContext();
      const page = await ctx.newPage();
      page.setDefaultTimeout(PAGE_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
      const entry: PoolEntry = { page, inUse: true, lastUsedAt: Date.now() };
      this.pool.push(entry);
      return entry;
    }

    // Wait briefly for one to free up. Simple poll — pool size is small.
    for (let i = 0; i < 50; i++) {
      await sleep(100);
      const e = this.pool.find((e) => !e.inUse);
      if (e) {
        e.inUse = true;
        return e;
      }
    }
    throw new Error("browser page pool exhausted");
  }

  private dropPage(entry: PoolEntry): void {
    const i = this.pool.indexOf(entry);
    if (i >= 0) this.pool.splice(i, 1);
    entry.page.close().catch(() => {});
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      locale: this.locale.acceptLanguage.split(",")[0] ?? "cs-CZ",
      userAgent: HEADER_USER_AGENT,
      viewport: { width: 1366, height: 900 },
      // Defeat header signatures used by simple bot heuristics.
      extraHTTPHeaders: { "accept-language": this.locale.acceptLanguage },
    });

    // Block heavy / tracking traffic before it leaves the browser.
    await context.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "media" || t === "font") return route.abort();

      const url = route.request().url();
      if (
        url.includes("googletagmanager.com") ||
        url.includes("google-analytics.com") ||
        url.includes("doubleclick.net") ||
        url.includes("/api/log/")
      ) {
        return route.abort();
      }
      return route.continue();
    });

    this.context = context;
    return context;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      if (this.cdpUrl) {
        log.info("alza-browser: connecting via CDP", { cdpUrl: this.cdpUrl });
        const browser = await chromium.connectOverCDP(this.cdpUrl);
        this.browser = browser;
        return browser;
      }
      log.info("alza-browser: launching managed Chromium", { headless: this.headless });
      const browser = await this.launchChromiumWithFallback();
      this.browser = browser;
      return browser;
    })().finally(() => {
      this.launching = undefined;
    });

    return this.launching;
  }

  private async launchChromiumWithFallback(): Promise<Browser> {
    const launchArgs = {
      headless: this.headless,
      args: ["--disable-blink-features=AutomationControlled"],
    };
    try {
      return await chromium.launch(launchArgs);
    } catch (err) {
      const message = (err as Error)?.message ?? "";
      const isMissingBinary =
        message.includes("Executable doesn't exist") ||
        message.includes("Looks like Playwright Test or Playwright was just installed");
      if (!isMissingBinary) throw err;

      log.info(
        "alza-browser: chromium not found — downloading headless-shell now (~92 MB, one-time). " +
          "Set ALZA_CDP_URL to skip the download and use your own Chrome."
      );
      await ensureChromiumInstalled();
      return chromium.launch(launchArgs);
    }
  }
}

async function ensureChromiumInstalled(): Promise<void> {
  let cliPath: string;
  try {
    const path = await import("node:path");
    const pkgJsonPath = require.resolve("playwright/package.json");
    cliPath = path.join(path.dirname(pkgJsonPath), "cli.js");
  } catch (err) {
    throw new Error(
      "Cannot find Playwright CLI. Run `npm install playwright` and retry.",
      { cause: err as Error }
    );
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "install", "chromium", "--only-shell"], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Failed to install Chromium (exit ${code}). Try \`npx playwright install chromium --only-shell\` manually.`
          )
        );
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
