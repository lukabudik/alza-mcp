#!/usr/bin/env bash
# Runs INSIDE the cursor image as `node`. Env: CURSOR_URI (decoded README badge
# deeplink), NPM_CONFIG_REGISTRY (harness registry). Writes evidence to /out.
#  1. Xvfb + fresh --user-data-dir + fresh $HOME; start Cursor (no login, ever).
#  2. Cursor's first window is the login-gated "Cursor Agents" window; a deeplink sent
#     to it alone does nothing. Open an editor window on an empty folder (works signed
#     out), then hand Cursor the deeplink with `cursor --open-url` (what the OS URL
#     handler does).
#  3. Read the "Install MCP server?" dialog over CDP, click Install, screenshot.
#  4. Assert ~/.cursor/mcp.json == {mcpServers:{alza:{command:npx,args:[-y,alza-mcp-community]}}} (env absent or {}).
#  5. Launch exactly that command and run initialize + tools/list.
set -uo pipefail
fail=0
check() { printf 'CHECK %-26s %-5s %s\n' "$1" "$2" "$3"; if [ "$2" = FAIL ]; then fail=1; fi; }
shot() { import -window root -resize 960x -colors 64 "PNG8:/out/$1" 2>/dev/null && echo "screenshot /out/$1 ($(du -k "/out/$1" | cut -f1) KB)"; }
C=/opt/cursor/usr/share/cursor/bin/cursor
VER="$(node -p "require('/opt/cursor/usr/share/cursor/resources/app/product.json').version" 2>/dev/null || grep X-AppImage-Version /opt/cursor/cursor.desktop)"
echo "Cursor $VER; URI: $CURSOR_URI"

Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
sleep 1
export DISPLAY=:99
eval "$(dbus-launch --sh-syntax)"
P=(--user-data-dir "$HOME/cursor-profile" --extensions-dir "$HOME/cursor-ext" --no-sandbox)
"$C" "${P[@]}" --disable-gpu --skip-welcome --skip-release-notes --remote-debugging-port=9230 >/tmp/cursor.log 2>&1 &
for _ in $(seq 1 60); do curl -fs http://127.0.0.1:9230/json/version >/dev/null && break; sleep 1; done
sleep 8

# What a signed-out first launch looks like, and what the deeplink does to it.
"$C" "${P[@]}" --open-url "$CURSOR_URI"
sleep 6
shot cursor-0-first-window.png
probe="$(node /harness/lib/cursor-probe.mjs 9230 | sed -n 's/^CURSOR_PROBE //p')"
echo "first-window probe: $probe"
login_gate="$(node -pe 'const r=JSON.parse(process.argv[1]); r.targets.some(t=>t.buttons.includes("Log In")) && !r.targets.some(t=>t.mentionsMcpInstall)' "$probe" 2>/dev/null)"
if [ "$login_gate" = true ]; then
  check cursor-login-gate INFO "signed-out first window ('Cursor Agents') shows only Log In / Sign Up and ignores the deeplink"
fi

mkdir -p "$HOME/empty-project"
"$C" "${P[@]}" --new-window "$HOME/empty-project"
sleep 10
"$C" "${P[@]}" --open-url "$CURSOR_URI"
sleep 6
shot cursor-1-install-dialog.png
dialog="$(node /harness/lib/cursor-click-install.mjs 9230)"
rc=$?
echo "$dialog"
djson="$(sed -n 's/^CURSOR_DIALOG //p' <<<"$dialog")"
if [ $rc -eq 0 ]; then
  shown="$(node -pe '
    const d = JSON.parse(process.argv[1]);
    const v = d.inputs.map((i) => i.value);
    const [name, command, ...rest] = v;
    const args = rest.filter((x, i) => d.inputs[i + 2].placeholder === "Argument" && x);
    const secrets = d.inputs.filter((i) => /^(Key|Value)$/.test(i.placeholder) && i.value);
    const ok = name === "alza" && command === "npx" && JSON.stringify(args) === JSON.stringify(["-y", "alza-mcp-community"]) && secrets.length === 0 && d.pressed.includes("Command");
    (ok ? "PASS " : "FAIL ") + `name=${name} type=${d.pressed.join("/")} command=${command} args=${JSON.stringify(args)} secrets=${secrets.length}`
  ' "$djson" 2>/dev/null || echo "FAIL could not parse dialog")"
  check cursor-dialog-fields "${shown%% *}" "${shown#* }"
  check cursor-deeplink-handler PASS "cursor --open-url showed 'Install MCP server?' in a signed-out editor window; Install clicked via CDP"
else
  check cursor-deeplink-handler FAIL "no install dialog (see cursor-1-install-dialog.png)"
fi
sleep 2
shot cursor-2-installed.png

MCP_JSON="$HOME/.cursor/mcp.json"
if [ -f "$MCP_JSON" ]; then
  cp "$MCP_JSON" /out/cursor-mcp.json && chmod a+r /out/cursor-mcp.json
  echo "--- $MCP_JSON"; cat "$MCP_JSON"; echo
  verdict="$(node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const names = Object.keys(j.mcpServers || {});
    const s = { ...(j.mcpServers || {}).alza };
    const emptyEnv = s.env !== undefined && Object.keys(s.env).length === 0;
    if (emptyEnv) delete s.env; // Cursor itself writes "env": {} for a config without env
    const ok = names.length === 1 && require("util").isDeepStrictEqual(s, { command: "npx", args: ["-y", "alza-mcp-community"] });
    console.log((ok ? "PASS " : "FAIL ") + "servers=" + JSON.stringify(names) + " alza=" + JSON.stringify(j.mcpServers.alza) + (emptyEnv ? " (env {} is added by Cursor, no variables)" : ""));
  ' "$MCP_JSON")"
  check cursor-mcp.json "${verdict%% *}" "${verdict#* }"
  mapfile -t CMD < <(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).mcpServers.alza; for (const p of [s.command, ...s.args]) console.log(p)' "$MCP_JSON")
  out="$(ALZA_TOKEN_FILE=none node /harness/lib/mcp-stdio-smoke.mjs --timeout-ms 300000 -- "${CMD[@]}")"
  rc=$?
  line="$(grep '^SMOKE_RESULT ' <<<"$out" | sed 's/^SMOKE_RESULT //')"
  detail="$(node -pe 'const r=JSON.parse(process.argv[1]); r.ok ? r.serverInfo.name+"@"+r.serverInfo.version+", "+r.toolCount+" tools" : r.error' "$line" 2>/dev/null)"
  if [ $rc -eq 0 ]; then check cursor-config-launches PASS "${CMD[*]} -> $detail"; else echo "$out"; check cursor-config-launches FAIL "${CMD[*]} -> $detail"; fi
else
  check cursor-mcp.json FAIL "no $MCP_JSON after Install"
fi
exit $fail
