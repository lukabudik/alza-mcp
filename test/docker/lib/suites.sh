#!/usr/bin/env bash
# Suites for scripts/docker-install-tests.sh (sourced; uses its variables and helpers:
# HD OUT SOURCE NET P LABEL REGISTRY_URL LIVE record collect registry_up build_image log).

# ---------------------------------------------------------------- badges
suite_badges() {
  local readme="$SOURCE/README.md"
  BADGES_RAN=1
  rm -f "$OUT/badges.json"   # never reuse URIs decoded from another tree
  if ! grep -q 'install-mcp\|mcp/install' "$readme"; then
    record badges readme BLOCKED "README has no one-click install badges (issue #22 not in this source tree)"
    return
  fi
  docker run --rm "${LABEL[@]}" -v "$readme:/src/README.md:ro" -v "$HD/lib:/harness/lib:ro" -v "$OUT:/out" \
    node:22-bookworm-slim node /harness/lib/decode-badges.mjs /src/README.md /out/badges.json --online \
    >"$OUT/badges.log" 2>&1
  collect badges "$OUT/badges.log"
}
badge_uri() { # vscodeUri | cursorDeeplink (needs suite_badges to have run)
  [ -f "$OUT/badges.json" ] || return 0
  node -p "require('$OUT/badges.json')['$1'] || ''" 2>/dev/null
}

# ---------------------------------------------------------------- VS Code
suite_vscode() {
  [ -n "${BADGES_RAN:-}" ] || suite_badges
  local uri; uri="$(badge_uri vscodeUri)"
  if [ -z "$uri" ]; then record vscode uri BLOCKED "no VS Code badge to decode"; return; fi
  registry_up || return
  build_image "$P/vscode" "$HD/Dockerfile.vscode" || { record vscode image FAIL "docker build"; return; }
  docker run --rm "${LABEL[@]}" --name "$P-vscode" --network "$NET" --shm-size=1g \
    -e VSCODE_URI="$uri" -e NPM_CONFIG_REGISTRY="$REGISTRY_URL/" \
    -v "$HD/lib:/harness/lib:ro" -v "$OUT:/out" "$P/vscode" bash /harness/lib/vscode-install.sh \
    >"$OUT/vscode.log" 2>&1
  collect vscode "$OUT/vscode.log"
}

# ---------------------------------------------------------------- Cursor
suite_cursor() {
  [ -n "${BADGES_RAN:-}" ] || suite_badges
  local uri; uri="$(badge_uri cursorDeeplink)"
  if [ -z "$uri" ]; then record cursor uri BLOCKED "no Cursor badge to decode"; return; fi
  registry_up || return
  build_image "$P/cursor" "$HD/Dockerfile.cursor" || { record cursor image FAIL "docker build (AppImage download?)"; return; }
  docker run --rm "${LABEL[@]}" --name "$P-cursor" --network "$NET" --shm-size=1g \
    -e CURSOR_URI="$uri" -e NPM_CONFIG_REGISTRY="$REGISTRY_URL/" \
    -v "$HD/lib:/harness/lib:ro" -v "$OUT:/out" "$P/cursor" bash /harness/lib/cursor-install.sh \
    >"$OUT/cursor.log" 2>&1
  collect cursor "$OUT/cursor.log"
}

# ---------------------------------------------------------------- Claude Desktop .mcpb
suite_mcpb() {
  if [ ! -f "$SOURCE/mcpb/manifest.json" ]; then
    record mcpb manifest BLOCKED "no mcpb/manifest.json in the source tree"
    return
  fi
  record mcpb claude-desktop INFO "Claude Desktop has no Linux build: the bundle is validated, unpacked and launched the way the host app would, not installed into the app"
  registry_up || return
  local stage="$OUT/mcpb-src"
  rm -rf "$stage" "$OUT/alza-mcp-community.mcpb" && mkdir -p "$stage/scripts"
  # Stage what build-mcpb.sh reads: every package.json "files" entry, the manifest,
  # package*.json and the build script itself (no node_modules, no repo extras).
  local f
  while IFS= read -r f; do
    mkdir -p "$stage/$(dirname "$f")" && cp -a "$SOURCE/$f" "$stage/$f"
  done < <(node -e "require('$SOURCE/package.json').files.forEach((f) => console.log(f))")
  cp -a "$SOURCE/mcpb" "$SOURCE/package.json" "$SOURCE/package-lock.json" "$stage/"
  cp -a "$SOURCE/scripts/build-mcpb.sh" "$stage/scripts/"
  docker run --rm "${LABEL[@]}" --name "$P-mcpb-build" --network "$NET" --user node \
    -e PHASE=build -e NPM_CONFIG_REGISTRY="$REGISTRY_URL/" -e HOME=/home/node \
    -v "$stage:/src:ro" -v "$HD/lib:/harness/lib:ro" -v "$OUT:/out" \
    node:22-bookworm-slim bash /harness/lib/mcpb-check.sh >"$OUT/mcpb-build.log" 2>&1
  collect mcpb "$OUT/mcpb-build.log"
  if [ ! -f "$OUT/alza-mcp-community.mcpb" ]; then record mcpb launch BLOCKED "no bundle built"; return; fi
  docker run --rm "${LABEL[@]}" --name "$P-mcpb-launch" --network none --user node \
    -e PHASE=launch -e HOME=/home/node -v "$HD/lib:/harness/lib:ro" -v "$OUT:/out" \
    node:22-bookworm-slim bash /harness/lib/mcpb-check.sh >"$OUT/mcpb-launch.log" 2>&1
  collect mcpb "$OUT/mcpb-launch.log"
}

# client_container <npm deps> [docker run options...] -- <command...>
# Clean node container on the harness network with <npm deps> installed under /client.
client_container() {
  local deps="$1"; shift
  local opts=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do opts+=("$1"); shift; done
  shift
  docker run --rm "${LABEL[@]}" --network "$NET" -e NPM_CONFIG_REGISTRY="$REGISTRY_URL/" \
    -v "$HD/lib:/harness/lib:ro" "${opts[@]}" node:22-bookworm-slim bash -c \
    'mkdir -p /client && cd /client && npm init -y >/dev/null && npm install --no-audit --no-fund '"$deps"' >/dev/null 2>&1 && cd / && exec "$@"' \
    client "$@"
}

# ---------------------------------------------------------------- Streamable HTTP
suite_http() {
  if ! tar xzOf "$OUT/alza-mcp-community.tgz" package/dist/http.js >/dev/null 2>&1; then
    record http transport BLOCKED "no dist/http.js in the packed build (issue #16 not in this source tree)"
    return
  fi
  registry_up || return
  build_image "$P/node:http" "$HD/Dockerfile.node" --build-arg BASE=node:22-bookworm-slim || { record http image FAIL "docker build"; return; }
  docker rm -f "$P-http" >/dev/null 2>&1
  docker run -d "${LABEL[@]}" --name "$P-http" --network "$NET" --network-alias alza-http \
    -e NPM_CONFIG_REGISTRY="$REGISTRY_URL/" -e HTTP_ALIAS=alza-http -v "$HD/lib:/harness/lib:ro" \
    "$P/node:http" bash /harness/lib/http-server.sh >/dev/null
  local ready=0
  for _ in $(seq 1 180); do
    if docker logs "$P-http" 2>&1 | grep -q HTTP_SERVERS_READY; then ready=1; break; fi
    docker ps -q --filter "name=$P-http" | grep -q . || break
    sleep 2
  done
  docker logs "$P-http" >"$OUT/http-server.log" 2>&1
  if [ $ready = 0 ]; then record http server FAIL "servers did not come up (http-server.log)"; return; fi
  record http server PASS "npx -y alza-mcp-community --http on :3000 (0.0.0.0), :3001 (default bind), :3002 (env-only, account mode)"
  grep -q '^LOOPBACK_3001 {"ok":true' "$OUT/http-server.log" \
    && record http loopback-in-container PASS "default-bind server answers /healthz on 127.0.0.1 inside its container" \
    || record http loopback-in-container FAIL "default-bind server not reachable on 127.0.0.1"
  client_container @modelcontextprotocol/sdk --name "$P-http-client" \
    -e MCP_URL=http://alza-http:3000/mcp -e MCP_ACCOUNT_URL=http://alza-http:3002/mcp -e MCP_LOOPBACK_URL=http://alza-http:3001/mcp -- \
    node /harness/lib/http-smoke.mjs >"$OUT/http-client.log" 2>&1
  collect http "$OUT/http-client.log"
  for p in 3000 3001 3002; do docker exec "$P-http" cat "/tmp/s$p.log" >>"$OUT/http-server.log" 2>/dev/null; done
  docker rm -f "$P-http" >/dev/null 2>&1
}

# ---------------------------------------------------------------- smithery.yaml
suite_smithery() {
  if [ ! -f "$SOURCE/smithery.yaml" ]; then record smithery yaml BLOCKED "no smithery.yaml"; return; fi
  registry_up || return
  mkdir -p "$OUT/dist-extract" && tar xzf "$OUT/alza-mcp-community.tgz" -C "$OUT/dist-extract"
  client_container yaml --name "$P-smithery" --user root \
    -v "$SOURCE/smithery.yaml:/src/smithery.yaml:ro" -v "$OUT/dist-extract/package/dist:/src/dist:ro" -- \
    node /harness/lib/smithery-check.mjs /src/smithery.yaml /src/dist >"$OUT/smithery.log" 2>&1
  collect smithery "$OUT/smithery.log"
}
