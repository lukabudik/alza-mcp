#!/usr/bin/env node
// Validate smithery.yaml the way Smithery uses it: parse YAML, sanity-check the
// configSchema, evaluate startCommand.commandFunction for an empty config and a
// full config, check every env var it emits is actually read by the server, and
// launch the resulting command (npx -y alza-mcp-community, resolved via the harness registry)
// with initialize + tools/list. Runs in a node container with `yaml` under /client.
// Usage: node smithery-check.mjs <smithery.yaml> <installed alza-mcp-community dist dir>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire("/client/");
const YAML = require("yaml");

const [yamlPath, distDir] = process.argv.slice(2);
let failed = false;
const check = (name, ok, detail) => {
  const s = ok === "info" ? "INFO" : ok ? "PASS" : "FAIL";
  if (s === "FAIL") failed = true;
  console.log(`CHECK ${name.padEnd(26)} ${s.padEnd(5)} ${detail}`);
};

const doc = YAML.parse(readFileSync(yamlPath, "utf8"));
const sc = doc.startCommand ?? {};
check("smithery-type", sc.type === "stdio", `startCommand.type=${sc.type}`);
const schema = sc.configSchema ?? {};
const props = Object.keys(schema.properties ?? {});
const badProps = props.filter((k) => !["string", "number", "boolean", "integer"].includes(schema.properties[k].type) || !schema.properties[k].description);
check("smithery-configSchema", schema.type === "object" && props.length > 0 && badProps.length === 0 && !(schema.required ?? []).length,
  `object with ${props.length} optional properties (${props.join(", ")})${badProps.length ? `; bad: ${badProps.join(",")}` : ""}`);

const fn = eval(sc.commandFunction); // eslint-disable-line no-eval — this is exactly what Smithery does with it
const sample = { string: "https://www.alza.sk", number: 60000, integer: 60000, boolean: true };
const full = Object.fromEntries(props.map((k) => [k, k === "alzaCdpUrl" ? "http://localhost:9222" : sample[schema.properties[k].type]]));
const empty = fn({});
check("smithery-cmd-empty", empty.command === "npx" && JSON.stringify(empty.args) === '["-y","alza-mcp-community"]' && Object.keys(empty.env ?? {}).length === 0,
  `{} -> ${JSON.stringify(empty)}`);
const all = fn(full);
check("smithery-cmd-full", all.command === "npx" && JSON.stringify(all.args) === '["-y","alza-mcp-community"]', `${JSON.stringify(full)} -> env ${JSON.stringify(all.env)}`);
const mapped = Object.keys(all.env ?? {});
check("smithery-every-prop-mapped", mapped.length === props.length, `${mapped.length}/${props.length} properties produce an env var`);
const envStrings = Object.values(all.env ?? {}).every((v) => typeof v === "string");
check("smithery-env-strings", envStrings, "all env values are strings");

// Every env var the function can set must be read somewhere in the shipped server code.
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith(".js") && files.push(join(d, f))));
walk(distDir);
const code = files.map((f) => readFileSync(f, "utf8")).join("\n");
const unread = mapped.filter((k) => !new RegExp(`process\\.env(\\.${k}\\b|\\[["']${k}["']\\])`).test(code));
check("smithery-env-read-by-server", unread.length === 0, unread.length ? `never read by dist/: ${unread.join(", ")}` : `${mapped.join(", ")} all read by dist/`);

// Launch: the empty-config command (what a default Smithery install runs). The full config
// points at a CDP URL that does not exist, so it is not launched.
const r = spawnSync(
  process.execPath,
  ["/harness/lib/mcp-stdio-smoke.mjs", "--timeout-ms", "300000", "--", empty.command, ...empty.args],
  { env: { ...process.env, ...empty.env, ALZA_TOKEN_FILE: "none" }, encoding: "utf8" }
);
const line = (r.stdout.match(/^SMOKE_RESULT (.*)$/m) ?? [])[1];
const res = line ? JSON.parse(line) : { error: r.stderr.slice(-300) };
if (!res.ok) console.log((res.stderrTail ?? []).map((l) => "  stderr| " + l).join("\n"));
check("smithery-launch", r.status === 0, res.ok ? `${empty.command} ${empty.args.join(" ")} -> ${res.serverInfo.name}@${res.serverInfo.version}, ${res.toolCount} tools` : res.error);

// Locale option end to end: ALZA_BASE_URL from alzaBaseUrl reaches the server.
const sk = fn({ alzaBaseUrl: "https://www.alza.sk" });
const r2 = spawnSync(
  process.execPath,
  ["/harness/lib/mcp-stdio-smoke.mjs", "--timeout-ms", "120000", "--", sk.command, ...sk.args],
  { env: { ...process.env, ...sk.env, ALZA_TOKEN_FILE: "none" }, encoding: "utf8" }
);
const line2 = (r2.stdout.match(/^SMOKE_RESULT (.*)$/m) ?? [])[1];
const sawSk = line2 && JSON.parse(line2).stderrTail.some((l) => l.includes("alza.sk"));
check("smithery-baseurl-applied", r2.status === 0 && sawSk, `alzaBaseUrl=https://www.alza.sk -> server ready log ${sawSk ? "reports" : "does NOT report"} baseUrl alza.sk`);
process.exit(failed ? 1 : 0);
