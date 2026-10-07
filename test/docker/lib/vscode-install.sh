#!/usr/bin/env bash
# Runs INSIDE the vscode image as `node`. Env: VSCODE_URI (the decoded README badge
# target), NPM_CONFIG_REGISTRY (harness registry). Writes evidence to /out.
#  1. Xvfb + a brand-new --user-data-dir; start VS Code, then hand it VSCODE_URI with
#     `code --open-url` (what the OS URL handler does: code-url-handler.desktop runs
#     `code --open-url %U`).
#  2. Screenshot the "MCP Server: alza" editor, click Install via the window's CDP port
#     (the only human step), screenshot again.
#  3. Assert <profile>/User/mcp.json == {servers:{alza:{type:stdio,command:npx,args:[-y,alza-mcp-community]}}}.
#  4. Launch exactly that command/args (npx -y alza-mcp-community from the harness registry) and run
#     initialize + tools/list over stdio.
#  5. Compare with `code --add-mcp` on a second fresh profile (reference for the same JSON).
set -uo pipefail
fail=0
check() { printf 'CHECK %-26s %-5s %s\n' "$1" "$2" "$3"; if [ "$2" = FAIL ]; then fail=1; fi; }
shot() { import -window root -resize 960x -colors 64 "PNG8:/out/$1" 2>/dev/null && echo "screenshot /out/$1 ($(du -k "/out/$1" | cut -f1) KB)"; }

echo "VS Code $(dpkg-query -W -f='${Version}' code); URI: $VSCODE_URI"
Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
sleep 1
export DISPLAY=:99
eval "$(dbus-launch --sh-syntax)"
PROFILE="$HOME/vscode-profile"
P=(--user-data-dir "$PROFILE" --extensions-dir "$HOME/vscode-ext" --no-sandbox)
code "${P[@]}" --disable-gpu --disable-workspace-trust --skip-welcome --skip-release-notes \
  --remote-debugging-port=9229 >/tmp/code.log 2>&1 &
for _ in $(seq 1 60); do curl -fs http://127.0.0.1:9229/json/version >/dev/null && break; sleep 1; done
sleep 4
code "${P[@]}" --open-url "$VSCODE_URI"
sleep 6
shot vscode-1-install-editor.png
if [ -f "$PROFILE/User/mcp.json" ] && grep -q alza "$PROFILE/User/mcp.json"; then
  check vscode-no-silent-install FAIL "mcp.json written before the user confirmed"
else
  check vscode-no-silent-install PASS "URI opened the 'MCP Server: alza' editor; nothing written until Install is clicked"
fi

if node /harness/lib/vscode-click-install.mjs 9229 alza; then
  check vscode-uri-handler PASS "code --open-url opened the install editor; Install clicked via CDP"
else
  check vscode-uri-handler FAIL "could not find/click the Install button (see screenshot)"
fi
sleep 2
shot vscode-2-installed.png

MCP_JSON="$PROFILE/User/mcp.json"
if [ -f "$MCP_JSON" ]; then
  cp "$MCP_JSON" /out/vscode-mcp.json && chmod a+r /out/vscode-mcp.json
  echo "--- $MCP_JSON"; cat "$MCP_JSON"; echo
  verdict="$(node -e '
    const fs = require("fs");
    // mcp.json is JSONC; VS Code writes plain JSON here, but strip comments defensively.
    const txt = fs.readFileSync(process.argv[1], "utf8").replace(/^\s*\/\/.*$/gm, "");
    const j = JSON.parse(txt);
    const names = Object.keys(j.servers || {});
    const s = (j.servers || {}).alza;
    const want = { type: "stdio", command: "npx", args: ["-y", "alza-mcp-community"] };
    const ok = names.length === 1 && s && require("util").isDeepStrictEqual(s, want);
    console.log((ok ? "PASS " : "FAIL ") + "servers=" + JSON.stringify(names) + " alza=" + JSON.stringify(s) + (s && "env" in s ? " (has env!)" : " (no env)"));
  ' "$MCP_JSON")"
  check vscode-mcp.json "${verdict%% *}" "${verdict#* }"
else
  check vscode-mcp.json FAIL "no $MCP_JSON after Install"
fi
if [ -f "$PROFILE/User/settings.json" ] && grep -q '"mcp"' "$PROFILE/User/settings.json"; then
  check vscode-settings.json WARN "settings.json also has an mcp block"
else
  check vscode-settings.json PASS "no MCP entries in settings.json (config lives only in user mcp.json)"
fi

# Launch exactly what VS Code would launch for this entry.
if [ -f "$MCP_JSON" ]; then
  mapfile -t CMD < <(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).servers.alza; for (const p of [s.command, ...s.args]) console.log(p)' "$MCP_JSON")
  out="$(ALZA_TOKEN_FILE=none node /harness/lib/mcp-stdio-smoke.mjs --timeout-ms 300000 -- "${CMD[@]}")"
  rc=$?
  line="$(grep '^SMOKE_RESULT ' <<<"$out" | sed 's/^SMOKE_RESULT //')"
  detail="$(node -pe 'const r=JSON.parse(process.argv[1]); r.ok ? r.serverInfo.name+"@"+r.serverInfo.version+", "+r.toolCount+" tools" : r.error' "$line" 2>/dev/null)"
  if [ $rc -eq 0 ]; then check vscode-config-launches PASS "${CMD[*]} -> $detail"; else echo "$out"; check vscode-config-launches FAIL "${CMD[*]} -> $detail"; fi
fi

# Reference: the CLI path with the same JSON on a second clean profile.
PROFILE2="$HOME/vscode-profile-addmcp"
JSON="$(node -e 'const c=JSON.parse(decodeURIComponent(process.argv[1].replace(/^vscode:mcp\/install\?/,""))); console.log(JSON.stringify(c))' "$VSCODE_URI")"
code --user-data-dir "$PROFILE2" --extensions-dir "$HOME/vscode-ext" --no-sandbox --add-mcp "$JSON" >/tmp/addmcp.log 2>&1
# VS Code's URI install adds "type": "stdio" explicitly; --add-mcp leaves it implicit (stdio is the default).
if node -e '
  const norm = (f) => Object.fromEntries(Object.entries(JSON.parse(require("fs").readFileSync(f, "utf8")).servers)
    .map(([k, v]) => [k, { type: "stdio", ...v }]));
  process.exit(require("util").isDeepStrictEqual(norm(process.argv[1]), norm(process.argv[2])) ? 0 : 1);
' "$MCP_JSON" "$PROFILE2/User/mcp.json" 2>/dev/null; then
  check vscode-add-mcp-equivalent PASS "code --add-mcp '$JSON' writes the same entry (only difference: implicit type stdio)"
else
  check vscode-add-mcp-equivalent WARN "--add-mcp result differs: $(cat "$PROFILE2/User/mcp.json" 2>/dev/null | tr -d '\n\t ')"
fi
exit $fail
