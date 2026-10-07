#!/usr/bin/env node
// Runs inside a throwaway node container on the harness network: creates a
// local user on the harness Verdaccio registry and publishes /pkg/alza-mcp-community.tgz
// to it (no lifecycle scripts run for a tarball publish). Never talks to npmjs.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const registry = process.env.HARNESS_REGISTRY ?? "http://registry:4873";
const user = "harness";
const password = "harness-local-only";

for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(`${registry}/-/ping`);
    if (r.ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const res = await fetch(`${registry}/-/user/org.couchdb.user:${user}`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: user, password, type: "user", roles: [], date: new Date().toISOString() }),
});
const body = await res.json();
if (!body.token) throw new Error(`registry adduser failed: ${res.status} ${JSON.stringify(body)}`);
const host = registry.replace(/^https?:/, "");
writeFileSync(`${process.env.HOME}/.npmrc`, `registry=${registry}/\n${host}/:_authToken=${body.token}\n`);
execFileSync("npm", ["publish", "/pkg/alza-mcp-community.tgz", "--registry", `${registry}/`, "--tag", "latest"], { stdio: "inherit" });
const meta = await (await fetch(`${registry}/alza-mcp-community`)).json();
console.log(`registry now serves alza-mcp-community dist-tags=${JSON.stringify(meta["dist-tags"])} versions=${Object.keys(meta.versions).join(",")}`);
