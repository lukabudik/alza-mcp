#!/usr/bin/env bash
# Clean-environment install/integration harness (Docker). NOT part of `npm test`.
#
#   npm run test:docker                       # every suite that applies to the source tree
#   npm run test:docker -- install http       # only some suites
#   scripts/docker-install-tests.sh --source ../alza-mcp-other-branch --live install
#
# Suites:
#   install   npm pack -> local registry -> `npx -y alza-mcp-community` / `npm install <tgz>` in clean
#             node:20/22/24 images with and without python3: postinstall, .venv-cf, sidecar
#             files, stdio initialize + tools/list (+ one live search_products with --live)
#   badges    decode + validate the README "Quick install" Cursor / VS Code badge payloads
#   vscode    official VS Code .deb + Xvfb, fresh --user-data-dir, open the README's vscode:
#             install URI, click Install through the workbench (CDP), assert the profile's
#             mcp.json, screenshot; falls back to `code --add-mcp` and says so
#   cursor    Cursor AppImage (extracted) + Xvfb, fresh profile, open the cursor:// deeplink
#   mcpb      build/validate the Claude Desktop .mcpb bundle, unpack it in a clean container,
#             launch it via manifest.server.mcp_config, initialize + tools/list
#   http      Streamable HTTP transport: server container (--http --port 3000) + SDK client
#             container, initialize/tools/list, two sessions, per-session toolset isolation
#   smithery  evaluate smithery.yaml commandFunction in node, launch the resulting command
#
# Options:
#   --source DIR   alza-mcp-community checkout to pack and test (default: this repo). The harness itself
#                  always comes from this repo, so another branch can be tested unmodified.
#   --live         allow ONE polite live search_products call from a clean container
#   --keep         keep containers/images/network for debugging
#   --out DIR      evidence/log dir (default: test/docker/.out)
#
# Every suite prints "CHECK <name> <PASS|FAIL|WARN|INFO|BLOCKED> <detail>" lines; a summary is
# written to $OUT/summary.txt and the script exits non-zero if any CHECK is FAIL.
set -uo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HD="$HARNESS_ROOT/test/docker"
SOURCE="$HARNESS_ROOT"
OUT="$HD/.out"
LIVE=0
KEEP=0
SUITES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$(cd "$2" && pwd)"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --live) LIVE=1; shift ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) SUITES+=("$1"); shift ;;
  esac
done
[ ${#SUITES[@]} -eq 0 ] && SUITES=(install badges vscode cursor mcpb http smithery)
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
chmod a+rwx "$OUT"   # containers run as uid 1000 (`node`) and write evidence here
SUMMARY="$OUT/summary.txt"
: >"$SUMMARY"

P=alza-mcp-community-harness            # prefix for every container/image/network we create
NET="$P-net"
REG="$P-registry"
REGISTRY_URL="http://registry:4873"
LABEL=(--label "$P=1")

log() { printf '\n\033[1m[%s] %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }
record() { # suite check status detail
  printf '%-9s %-28s %-7s %s\n' "$1" "$2" "$3" "$4" | tee -a "$SUMMARY"
}
collect() { # suite logfile -> copy its CHECK lines into the summary
  grep -a '^CHECK ' "$2" | while read -r _ name status detail; do record "$1" "$name" "$status" "$detail"; done
}

cleanup() {
  [ "$KEEP" = 1 ] && { log "--keep: leaving $P containers/images/network"; return; }
  log "cleanup"
  docker ps -aq --filter "label=$P=1" | xargs -r docker rm -f >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  docker images -q --filter "label=$P=1" | sort -u | xargs -r docker rmi -f >/dev/null 2>&1
  true
}
trap cleanup EXIT

# ---------------------------------------------------------------- build + pack
pack() {
  log "build + npm pack ($SOURCE @ $(git -C "$SOURCE" rev-parse --short HEAD 2>/dev/null || echo '?'))"
  (
    cd "$SOURCE" || exit 1
    [ -d node_modules ] || ALZA_MCP_SKIP_INSTALL=1 npm ci --no-audit --no-fund >"$OUT/pack.log" 2>&1 || exit 1
    npm run build >>"$OUT/pack.log" 2>&1 || exit 1
    rm -f "$OUT"/alza-mcp-community-*.tgz
    npm pack --pack-destination "$OUT" >>"$OUT/pack.log" 2>&1 || exit 1
  ) || { record setup pack FAIL "build/pack failed, see pack.log"; exit 1; }
  TGZ="$(ls "$OUT"/alza-mcp-community-*.tgz | head -1)"
  cp "$TGZ" "$OUT/alza-mcp-community.tgz"
  record setup pack PASS "$(basename "$TGZ") ($(du -k "$TGZ" | cut -f1) KB, $(tar tzf "$TGZ" | wc -l) files)"
}

registry_up() {
  [ -n "${REGISTRY_READY:-}" ] && return 0
  log "local registry (verdaccio) + publish packed build"
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "${LABEL[@]}" "$NET" >/dev/null
  docker rm -f "$REG" >/dev/null 2>&1
  docker run -d "${LABEL[@]}" --name "$REG" --network "$NET" --network-alias registry \
    -v "$HD/verdaccio/config.yaml:/verdaccio/conf/config.yaml:ro" verdaccio/verdaccio:6 >/dev/null
  if docker run --rm "${LABEL[@]}" --network "$NET" -v "$OUT/alza-mcp-community.tgz:/pkg/alza-mcp-community.tgz:ro" \
      -v "$HD/lib:/harness/lib:ro" -e HARNESS_REGISTRY="$REGISTRY_URL" node:22-bookworm-slim \
      node /harness/lib/registry-publish.mjs >"$OUT/registry-publish.log" 2>&1; then
    record setup registry PASS "$(tail -1 "$OUT/registry-publish.log")"
    REGISTRY_READY=1
  else
    record setup registry FAIL "publish failed, see registry-publish.log"
    return 1
  fi
}

build_image() { # tag dockerfile [build-args...]
  local tag="$1" df="$2"; shift 2
  docker build -q "${LABEL[@]}" -t "$tag" -f "$df" "$@" "$HD" >/dev/null
}

# ---------------------------------------------------------------- install matrix
suite_install() {
  registry_up || return
  # name | base image | PYTHON | BROWSER_DEPS | MODE | EXPECT_VENV | LIVE
  local matrix=(
    "node22-slim-nopython|node:22-bookworm-slim|none|0|npx|no|0"
    "node22-slim-python|node:22-bookworm-slim|venv|1|npx|yes|$LIVE"
    "node20-slim-nopython|node:20-bookworm-slim|none|0|tarball|no|0"
    "node20-slim-python|node:20-bookworm-slim|venv|0|tarball|yes|0"
    "node22-full-python-novenv|node:22-bookworm|none|0|npx|no|0"
    "node24-slim-python|node:24-bookworm-slim|venv|0|npx|yes|0"
    "node24-slim-python-project|node:24-bookworm-slim|venv|0|tarball|yes|0"
  )
  if [ -n "${MATRIX_FILTER:-}" ]; then # e.g. MATRIX_FILTER=node24 to rerun a subset
    local filtered=() r
    for r in "${matrix[@]}"; do [[ "${r%%|*}" == *"$MATRIX_FILTER"* ]] && filtered+=("$r"); done
    matrix=("${filtered[@]}")
  fi
  local pids=() row name base py deps mode expect live
  for row in "${matrix[@]}"; do
    IFS='|' read -r name base py deps mode expect live <<<"$row"
    (
      build_image "$P/node:$name" "$HD/Dockerfile.node" --build-arg BASE="$base" \
        --build-arg PYTHON="$py" --build-arg BROWSER_DEPS="$deps" || { echo "CHECK image FAIL docker build"; exit 1; }
      docker run --rm "${LABEL[@]}" --name "$P-install-$name" --network "$NET" \
        -e NPM_CONFIG_REGISTRY="$REGISTRY_URL/" -e MODE="$mode" -e EXPECT_VENV="$expect" -e LIVE="$live" \
        -v "$OUT/alza-mcp-community.tgz:/pkg/alza-mcp-community.tgz:ro" -v "$HD/lib:/harness/lib:ro" \
        "$P/node:$name" bash /harness/lib/check-install.sh
    ) >"$OUT/install-$name.log" 2>&1 &
    pids+=($!)
  done
  log "install matrix: ${#matrix[@]} containers in parallel (logs: $OUT/install-*.log)"
  wait "${pids[@]}"
  for row in "${matrix[@]}"; do
    IFS='|' read -r name _ <<<"$row"
    collect "install:$name" "$OUT/install-$name.log"
  done
}

# Remaining suites live in test/docker/lib/suites.sh so this file stays readable.
# shellcheck source=../test/docker/lib/suites.sh
source "$HD/lib/suites.sh"

pack
for s in "${SUITES[@]}"; do
  if declare -F "suite_$s" >/dev/null; then
    log "suite: $s"
    "suite_$s"
  else
    record "$s" suite FAIL "unknown suite"
  fi
done

log "summary ($SUMMARY)"
cat "$SUMMARY"
! grep -q ' FAIL ' "$SUMMARY"
