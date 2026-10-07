#!/usr/bin/env node
// Decode and validate the README "One-click install" badge targets.
//
// Usage: node decode-badges.mjs <README.md> <out.json> [--online]
//
// For each badge it derives the URI the editor's OS-level URL handler would
// receive and asserts that the encoded server config is exactly
//   { command: "npx", args: ["-y", "alza-mcp-community"] }   (no env, no other keys)
// and that the server name is "alza". With --online it also requests the https
// redirect pages (VS Code's insiders.vscode.dev/redirect, cursor.com/install-mcp)
// to confirm where they send the browser. Writes the decoded URIs to <out.json>
// for the vscode/cursor suites. Prints CHECK lines; exit 1 on any FAIL.
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const [readmePath, outPath, ...rest] = process.argv.slice(2);
const online = rest.includes("--online");
const EXPECTED = { command: "npx", args: ["-y", "alza-mcp-community"] };
const EXPECTED_NAME = "alza";
let failed = false;
const check = (name, ok, detail) => {
  const status = ok === null ? "BLOCKED" : ok === "warn" ? "WARN" : ok ? "PASS" : "FAIL";
  if (status === "FAIL") failed = true;
  console.log(`CHECK ${name.padEnd(26)} ${status.padEnd(5)} ${detail}`);
};

const readme = readFileSync(readmePath, "utf8");
const links = [...readme.matchAll(/\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)\s]+)\)/g)].map((m) => ({ alt: m[1], img: m[2], href: m[3] }));
const cursor = links.find((l) => /cursor/i.test(l.alt) || /cursor\.com\/(?:[a-z-]+\/)?install-mcp|cursor:\/\//.test(l.href));
const vscode = links.find((l) => /vs ?code/i.test(l.alt) && !/insiders/i.test(l.alt));
const out = { readme: readmePath, links: { cursor: cursor?.href, vscode: vscode?.href } };

function validateConfig(label, cfg, name) {
  const extra = Object.keys(cfg).filter((k) => !["command", "args", "name", "type"].includes(k));
  check(`${label}-name`, name === EXPECTED_NAME, `name=${JSON.stringify(name)}`);
  check(`${label}-config`, cfg.command === EXPECTED.command && isDeepStrictEqual(cfg.args, EXPECTED.args),
    `command=${JSON.stringify(cfg.command)} args=${JSON.stringify(cfg.args)}`);
  check(`${label}-no-env`, !("env" in cfg) && !("envFile" in cfg) && extra.length === 0,
    extra.length || "env" in cfg ? `unexpected keys: ${[...extra, "env" in cfg ? "env" : ""].filter(Boolean).join(",")}` : "no env, no extra keys");
  if (cfg.type !== undefined) check(`${label}-type`, cfg.type === "stdio", `type=${cfg.type}`);
}

// ---- Cursor: https://cursor.com/[en/]install-mcp?name=..&config=<base64 JSON>
//      or cursor://anysphere.cursor-deeplink/mcp/install?name=..&config=<base64 JSON>
if (!cursor) {
  check("cursor-badge", false, "no Cursor badge link in README");
} else {
  const u = new URL(cursor.href);
  const name = u.searchParams.get("name");
  const b64 = u.searchParams.get("config") ?? "";
  let cfg = {};
  try {
    cfg = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    check("cursor-badge-decode", true, `${u.origin}${u.pathname} -> base64 config ${JSON.stringify(cfg)}`);
  } catch (e) {
    check("cursor-badge-decode", false, `config is not base64 JSON: ${e.message}`);
  }
  validateConfig("cursor", cfg, name);
  // Same query string the cursor.com page hands to the desktop app's URL handler.
  out.cursorDeeplink = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name ?? "")}&config=${encodeURIComponent(b64)}`;
  out.cursorConfig = cfg;
  check("cursor-badge-image", /^https:\/\/cursor\.com\/deeplink\/mcp-install-(dark|light)\.svg$/.test(cursor.img), cursor.img);
}

// ---- VS Code: https://insiders.vscode.dev/redirect/mcp/install?name=..&config=<url-encoded JSON>
//      (redirects to vscode:mcp/install?<url-encoded JSON incl. name>) or a vscode: URI directly.
if (!vscode) {
  check("vscode-badge", false, "no VS Code badge link in README");
} else {
  const u = new URL(vscode.href);
  let cfg = {};
  let name;
  if (u.protocol === "vscode:") {
    cfg = JSON.parse(decodeURIComponent(u.search.slice(1)));
    name = cfg.name;
    out.vscodeUri = vscode.href;
  } else {
    name = u.searchParams.get("name");
    try {
      cfg = JSON.parse(u.searchParams.get("config") ?? "");
    } catch (e) {
      check("vscode-badge-decode", false, `config is not URL-encoded JSON: ${e.message}`);
    }
    // What the redirect service produces (verified below with --online).
    out.vscodeUri = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ ...cfg, name }))}`;
    const quality = u.searchParams.get("quality");
    if (quality === "insiders") out.vscodeUri = out.vscodeUri.replace(/^vscode:/, "vscode-insiders:");
  }
  check("vscode-badge-decode", true, `${u.origin}${u.pathname} -> config ${JSON.stringify(cfg)}`);
  validateConfig("vscode", cfg, name);
  out.vscodeConfig = cfg;
}

if (online) {
  if (vscode && vscode.href.startsWith("https://")) {
    try {
      const r = await fetch(vscode.href, { redirect: "manual" });
      const loc = r.headers.get("location") ?? "";
      let redirected = {};
      try {
        redirected = JSON.parse(decodeURIComponent(loc.replace(/^vscode(-insiders)?:mcp\/install\?/, "")));
      } catch {
        /* checked below */
      }
      const ok = r.status >= 300 && r.status < 400 && /^vscode:mcp\/install\?/.test(loc) &&
        isDeepStrictEqual({ ...redirected }, { ...out.vscodeConfig, name: EXPECTED_NAME });
      check("vscode-redirect", ok, `HTTP ${r.status} Location: ${loc}`);
      if (ok) out.vscodeUri = loc; // use the exact redirect target, byte for byte
    } catch (e) {
      check("vscode-redirect", null, `could not reach ${new URL(vscode.href).host}: ${e.message}`);
    }
  }
  if (cursor && cursor.href.startsWith("https://")) {
    try {
      const r = await fetch(cursor.href, { redirect: "follow" });
      const html = await r.text();
      const qsKept = new URL(r.url).searchParams.get("config") === new URL(cursor.href).searchParams.get("config");
      // The landing page builds the cursor:// URL client-side; look for the scheme in the page or its JS chunks.
      let seen = /anysphere\.cursor-deeplink/.test(html);
      if (!seen) {
        const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], r.url).href).slice(0, 40);
        for (const s of scripts) {
          const js = await (await fetch(s)).text().catch(() => "");
          if (/anysphere\.cursor-deeplink/.test(js)) {
            seen = true;
            break;
          }
        }
      }
      check("cursor-landing", r.ok && qsKept ? (seen ? true : "warn") : false,
        `HTTP ${r.status} ${r.url} (query preserved: ${qsKept}; cursor-deeplink scheme found in page/JS: ${seen})`);
    } catch (e) {
      check("cursor-landing", null, `could not reach cursor.com: ${e.message}`);
    }
  }
}

writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`decoded URIs written to ${outPath}`);
console.log(`  vscode: ${out.vscodeUri}`);
console.log(`  cursor: ${out.cursorDeeplink}`);
process.exit(failed ? 1 : 0);
