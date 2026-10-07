#!/usr/bin/env bash
# Runs INSIDE a clean test container as the unprivileged `node` user.
# Installs alza-mcp-community from the harness registry the way an MCP client does
# (`npx -y alza-mcp-community`) or via `npm install <tarball>`, then asserts:
#   - postinstall ran (its [alza-mcp-community] output / .postinstall.log),
#   - .venv-cf with curl_cffi exists iff python3 + venv are available,
#   - the CF sidecar files ship in the package,
#   - the server answers initialize + tools/list over stdio,
#   - optionally one live search_products call (LIVE=1, reported, never fails the run).
# Prints "CHECK <name> <PASS|FAIL|WARN|INFO> <detail>" lines; exits 1 if any FAIL.
set -uo pipefail

MODE="${MODE:-npx}"                 # npx | tarball
EXPECT_VENV="${EXPECT_VENV:-auto}"  # yes | no | auto
LIVE="${LIVE:-0}"
export ALZA_TOKEN_FILE=none
fail=0
check() { # name status detail
  printf 'CHECK %-26s %-5s %s\n' "$1" "$2" "$3"
  if [ "$2" = "FAIL" ]; then fail=1; fi
}
json() { node -pe "const r=JSON.parse(process.argv[1]); $2" "$1" 2>/dev/null; }

echo "== environment"
echo "node $(node -v) / npm $(npm -v) / $(. /etc/os-release && echo "$PRETTY_NAME")"
if command -v python3 >/dev/null; then
  echo "python3: $(python3 --version 2>&1); venv+ensurepip: $(python3 -c 'import ensurepip, venv; print("yes")' 2>/dev/null || echo no)"
else
  echo "python3: absent"
fi
echo "registry: $(npm config get registry)"

cd "$HOME"
INSTALL_LOG="$HOME/install.log"
if [ "$MODE" = "tarball" ]; then
  mkdir -p app && cd app && npm init -y >/dev/null
  echo "== npm install /pkg/alza-mcp-community.tgz"
  npm install --no-audit --no-fund --foreground-scripts /pkg/alza-mcp-community.tgz >"$INSTALL_LOG" 2>&1
  rc=$?
  PKG_DIR="$HOME/app/node_modules/alza-mcp-community"
  RUN=(node "$PKG_DIR/dist/index.js")
else
  echo "== npm exec --yes --package=alza-mcp-community (same npx cache install an MCP client's 'npx -y alza-mcp-community' does)"
  # --foreground-scripts only makes postinstall output visible in the log.
  npm exec --yes --foreground-scripts --package=alza-mcp-community -- node -e 'process.exit(0)' >"$INSTALL_LOG" 2>&1
  rc=$?
  PKG_DIR="$(dirname "$(find "$HOME/.npm/_npx" -path '*/node_modules/alza-mcp-community/package.json' 2>/dev/null | head -1)")"
  RUN=(npx -y alza-mcp-community)
fi
grep -v -e '■' -e '^ *$' "$INSTALL_LOG" | sed 's/^/  | /' | tail -40
if [ $rc -eq 0 ]; then check install PASS "exit 0 ($MODE)"; else check install FAIL "exit $rc ($MODE)"; fi
if [ ! -f "$PKG_DIR/package.json" ]; then check package-dir FAIL "alza-mcp-community not found"; exit 1; fi
echo "package dir: $PKG_DIR (version $(node -p "require('$PKG_DIR/package.json').version"))"

if grep -q '\[alza-mcp-community\]' "$INSTALL_LOG" || [ -f "$PKG_DIR/.postinstall.log" ]; then
  check postinstall-ran PASS "$(head -c 200 "$PKG_DIR/.postinstall.log" 2>/dev/null | tr '\n' ';')"
else
  check postinstall-ran FAIL "no [alza-mcp-community] output and no .postinstall.log (lifecycle script skipped?)"
fi

if grep -q 'install-scripts' "$INSTALL_LOG"; then
  check npm-install-scripts INFO "npm $(npm -v) warns: $(grep -m1 'install-scripts' "$INSTALL_LOG" | sed 's/^npm warn install-scripts //' | head -c 140) (postinstall still ran)"
fi

missing=""
for f in scripts/cf-transport.py scripts/ensure-cf-venv.sh scripts/postinstall.cjs dist/index.js; do
  [ -f "$PKG_DIR/$f" ] || missing="$missing $f"
done
if [ -z "$missing" ]; then check sidecar-files PASS "cf-transport.py, ensure-cf-venv.sh, postinstall.cjs, dist/index.js"
else check sidecar-files FAIL "missing:$missing"; fi

if [ "$EXPECT_VENV" = "auto" ]; then
  if python3 -c 'import ensurepip, venv' 2>/dev/null; then EXPECT_VENV=yes; else EXPECT_VENV=no; fi
fi
if [ -x "$PKG_DIR/.venv-cf/bin/python" ] && "$PKG_DIR/.venv-cf/bin/python" -c 'import curl_cffi' 2>/dev/null; then
  have="curl_cffi $("$PKG_DIR/.venv-cf/bin/python" -c 'import curl_cffi; print(curl_cffi.__version__)')"
  if [ "$EXPECT_VENV" = yes ]; then check cf-venv PASS "created with $have"; else check cf-venv FAIL "unexpected venv: $have"; fi
elif [ "$EXPECT_VENV" = no ]; then
  check cf-venv PASS "absent as expected (python3/venv unavailable); install still exit 0"
else
  check cf-venv FAIL ".venv-cf missing or curl_cffi not importable although python3+venv exist"
fi

if ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-* >/dev/null 2>&1; then
  check chromium-download PASS "$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-* | xargs -n1 basename | tr '\n' ' ')"
else
  check chromium-download WARN "no headless shell in ~/.cache/ms-playwright (server retries on first browser use)"
fi

echo "== stdio smoke: ${RUN[*]}"
smoke_args=(--timeout-ms 240000)
if [ "$LIVE" = 1 ]; then smoke_args+=(--live); fi
out="$(node /harness/lib/mcp-stdio-smoke.mjs "${smoke_args[@]}" -- "${RUN[@]}")"
src=$?
line="$(grep '^SMOKE_RESULT ' <<<"$out" | sed 's/^SMOKE_RESULT //')"
if [ -n "$line" ]; then
  json "$line" '[
    "serverInfo: " + JSON.stringify(r.serverInfo) + " protocol: " + r.protocolVersion,
    "tools (" + r.toolCount + "): " + (r.tools || []).join(", "),
    r.error ? "error: " + r.error : "",
    r.live ? "LIVE search_products: " + JSON.stringify(r.live) : "",
    ...(r.stderrTail || []).map((l) => "  stderr| " + l),
  ].filter(Boolean).join("\n")'
else
  echo "$out"
fi
if [ $src -eq 0 ]; then
  check stdio-initialize+tools PASS "$(json "$line" 'r.serverInfo.name + "@" + r.serverInfo.version + ", " + r.toolCount + " tools"')"
else
  check stdio-initialize+tools FAIL "$(json "$line" 'r.error' || echo 'no result')"
fi
if [ "$LIVE" = 1 ]; then
  check live-search_products "$(json "$line" 'r.live && !r.live.isError ? "PASS" : "INFO"' || echo INFO)" \
    "$(json "$line" 'r.live ? (r.live.isError ? "error after " + r.live.ms + "ms: " + r.live.textHead.slice(0, 160) : r.live.productCount + " products in " + r.live.ms + "ms, first: " + r.live.firstProductName) : "n/a"')"
fi
exit $fail
