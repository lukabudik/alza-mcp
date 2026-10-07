#!/usr/bin/env bash
# Runs INSIDE clean node containers. Two phases (PHASE env):
#   build   /src is a read-only copy of the source tree (with dist/ built). Copy it, run
#           scripts/build-mcpb.sh exactly like the release workflow (npm ci --ignore-scripts
#           first), then `mcpb validate` + `mcpb info`; leaves /out/alza-mcp-community.mcpb.
#   launch  a DIFFERENT clean container started with --network none (Claude Desktop runs the
#           bundle with its own Node and does no npm install): unzip the bundle, resolve
#           manifest.server.mcp_config like the host app does (${__dirname}, ${user_config.*}
#           defaults), launch it, initialize + tools/list.
set -uo pipefail
fail=0
check() { printf 'CHECK %-26s %-5s %s\n' "$1" "$2" "$3"; if [ "$2" = FAIL ]; then fail=1; fi; }

if [ "$PHASE" = build ]; then
  mkdir -p "$HOME/src" && cp -a /src/. "$HOME/src/" && cd "$HOME/src" || exit 1
  pkgv="$(node -p "require('./package.json').version")"; manv="$(node -p "require('./mcpb/manifest.json').version")"
  if [ "$pkgv" = "$manv" ]; then check mcpb-version-sync PASS "manifest $manv == package.json $pkgv"
  else check mcpb-version-sync FAIL "mcpb/manifest.json version $manv != package.json $pkgv (build-mcpb.sh and the release workflow refuse this)"; fi
  if bash scripts/build-mcpb.sh >"$HOME/build.log" 2>&1; then
    check mcpb-build PASS "$(tail -1 "$HOME/build.log")"
  else
    tail -15 "$HOME/build.log"
    check mcpb-build FAIL "scripts/build-mcpb.sh failed: $(grep -m1 -iE 'error|!=' "$HOME/build.log")"
    exit 1
  fi
  B="$(ls build/*.mcpb | head -1)"
  cp "$B" /out/alza-mcp-community.mcpb
  if npx --yes @anthropic-ai/mcpb validate mcpb/manifest.json >"$HOME/validate.log" 2>&1; then
    check mcpb-validate PASS "$(tail -1 "$HOME/validate.log")"
  else
    cat "$HOME/validate.log"; check mcpb-validate FAIL "mcpb validate failed"
  fi
  npx --yes @anthropic-ai/mcpb info "$B" 2>&1 | tee "$HOME/info.log" | sed 's/^/  info| /'
  check mcpb-info PASS "$(basename "$B"): $(du -k "$B" | cut -f1) KB on disk; mcpb info: $(grep -m1 '^Size' "$HOME/info.log")"
  # Signature status is informative only (unsigned bundles install with a warning in Claude Desktop).
  npx --yes @anthropic-ai/mcpb verify "$B" >/dev/null 2>&1 && check mcpb-signature INFO "signed" || check mcpb-signature INFO "unsigned bundle (Claude Desktop shows an 'unverified' notice)"
  exit $fail
fi

# ---- launch phase (no network)
mkdir -p "$HOME/ext" && cd "$HOME/ext" || exit 1
node -e '
  // Minimal zip extraction with Node built-ins only (no unzip in the image, no network).
  const fs = require("fs"), path = require("path"), zlib = require("zlib");
  const buf = fs.readFileSync("/out/alza-mcp-community.mcpb");
  let eocd = buf.length - 22; while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let off = buf.readUInt32LE(eocd + 16); const n = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const extAttr = buf.readUInt32LE(off + 38), lho = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nlen);
    off += 46 + nlen + xlen + clen;
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    if (name.endsWith("/")) { fs.mkdirSync(name, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(name) || ".", { recursive: true });
    fs.writeFileSync(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    const mode = (extAttr >>> 16) & 0o777; if (mode) fs.chmodSync(name, mode);
  }
  console.log("unpacked " + n + " entries");
'
for f in manifest.json dist/index.js node_modules/@modelcontextprotocol/sdk/package.json node_modules/playwright/package.json; do
  [ -e "$f" ] || { check mcpb-contents FAIL "bundle lacks $f"; }
done
check mcpb-contents PASS "manifest.json, dist/, node_modules (prod deps) present; $(find . -type f | wc -l) files"
# The bundle must ship the Chrome-fingerprint sidecar like the npm package does.
if [ -f scripts/cf-transport.py ] && [ -f scripts/ensure-cf-venv.sh ]; then
  check mcpb-sidecar PASS "scripts/cf-transport.py + scripts/ensure-cf-venv.sh bundled"
else
  check mcpb-sidecar FAIL "sidecar not in the bundle: account/OAuth calls lose the Chrome-fingerprint transport"
fi
pkg_files_missing="$(node -e 'const p=require("./package.json");const fs=require("fs");console.log((p.files||[]).filter(f=>!fs.existsSync(f)).join(" "))')"
if [ -z "$pkg_files_missing" ]; then check mcpb-package-files PASS "every package.json \"files\" entry is in the bundle"
else check mcpb-package-files FAIL "missing from bundle: $pkg_files_missing"; fi

[ "$(node -p 'require("./manifest.json").server.entry_point')" = dist/index.js ] && [ -f dist/index.js ] \
  && check mcpb-entry_point PASS "server.entry_point dist/index.js exists" || check mcpb-entry_point FAIL "entry_point missing"

# launch_with <check-name> <defaults|empty>: resolve mcp_config like the host app and run the smoke.
#   defaults  every ${user_config.X} -> its manifest default (what an untouched install gets)
#   empty     every ${user_config.X} -> "" (the user cleared an optional field)
launch_with() {
  local name="$1" mode="$2" CMD=() ENVS=() ARGV=() x out rc line detail
  mapfile -t CMD < <(MODE="$mode" node -e '
    const m = require("./manifest.json");
    const dir = process.cwd();
    const vals = Object.fromEntries(Object.entries(m.user_config || {}).map(([k, v]) => [k, process.env.MODE === "empty" ? "" : v.default ?? ""]));
    const sub = (s) => String(s).replace(/\$\{__dirname\}/g, dir).replace(/\$\{user_config\.([\w-]+)\}/g, (_, k) => vals[k] ?? "");
    const c = m.server.mcp_config;
    // command first, then args; env as KEY=VALUE lines prefixed with "ENV:"
    console.log(c.command === "node" ? process.execPath : sub(c.command));
    for (const a of c.args || []) console.log(sub(a));
    for (const [k, v] of Object.entries(c.env || {})) console.log("ENV:" + k + "=" + sub(v));
  ')
  for x in "${CMD[@]}"; do if [[ "$x" == ENV:* ]]; then ENVS+=("${x#ENV:}"); else ARGV+=("$x"); fi; done
  echo "resolved mcp_config ($mode): ${ENVS[*]} ${ARGV[*]}"
  out="$(env "${ENVS[@]}" ALZA_TOKEN_FILE=none node /harness/lib/mcp-stdio-smoke.mjs --timeout-ms 60000 -- "${ARGV[@]}")"
  rc=$?
  line="$(grep '^SMOKE_RESULT ' <<<"$out" | sed 's/^SMOKE_RESULT //')"
  detail="$(node -pe 'const r=JSON.parse(process.argv[1]); r.ok ? r.serverInfo.name+"@"+r.serverInfo.version+", "+r.toolCount+" tools" : r.error + " | " + (r.stderrTail || []).join(" ").slice(0, 200)' "$line" 2>/dev/null)"
  if [ $rc -eq 0 ]; then check "$name" PASS "[${ENVS[*]}] $detail (offline, --network none)"; else echo "$out"; check "$name" FAIL "[${ENVS[*]}] $detail"; fi
}
launch_with mcpb-launch defaults
launch_with mcpb-launch-empty-config empty
exit $fail
