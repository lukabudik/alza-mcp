#!/usr/bin/env tsx
/**
 * Memory + idle-shutdown probe. Run a few tool calls, sample RSS of any
 * chrome-headless-shell processes between calls, then sleep past the idle
 * TTL and verify the browser shuts itself down.
 *
 *   ALZA_IDLE_TTL_MS=4000 npx tsx scripts/probe-memory.ts
 */
import { spawnSync } from "node:child_process";
import { Catalog } from "../src/domain/catalog.js";
import { AlzaBrowser } from "../src/infra/browser.js";

function chromiumRssMb(): { count: number; totalMb: number } {
  const out = spawnSync("ps", ["-eo", "pid,rss,command"], { encoding: "utf8" }).stdout || "";
  const lines = out
    .split("\n")
    .filter((l) => l.includes("chromium_headless_shell") && !l.includes("grep"));
  const totalMb = lines.reduce((sum, l) => {
    const parts = l.trim().split(/\s+/);
    return sum + Number(parts[1] ?? 0) / 1024;
  }, 0);
  return { count: lines.length, totalMb: Math.round(totalMb) };
}

function snap(label: string): void {
  const s = chromiumRssMb();
  process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${label.padEnd(28)} chrome procs: ${s.count}, RAM: ${s.totalMb} MB\n`);
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const browser = new AlzaBrowser();
  const catalog = new Catalog(browser);

  snap("baseline");

  await catalog.searchProducts({ query: "iphone", limit: 3 });
  snap("after search 1");

  await catalog.searchProducts({ query: "macbook", limit: 3 });
  snap("after search 2");

  await catalog.searchProducts({ query: "headphones", limit: 3 });
  snap("after search 3");

  // Now wait for idle shutdown.
  const idleMs = Number(process.env.ALZA_IDLE_TTL_MS ?? 4000);
  process.stdout.write(`\nwaiting ${idleMs + 2000}ms for idle shutdown …\n`);
  await sleep(idleMs + 2000);
  snap("after idle wait");

  // Final cleanup.
  await browser.close();
  snap("after close()");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
