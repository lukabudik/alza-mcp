#!/usr/bin/env bash
# Runs INSIDE the HTTP server container as `node`: installs alza-mcp-community from the harness
# registry with npx (as the README's `npx -y alza-mcp-community --http` does), then starts:
#   :3000  --http --port 3000 --host 0.0.0.0   (default catalog-only mode, reachable on the network)
#   :3001  --http --port 3001                  (default bind: must stay loopback-only)
#   :3002  ALZA_TRANSPORT=http ALZA_HTTP_PORT=3002 ALZA_HTTP_HOST=0.0.0.0 ALZA_HTTP_ENABLE_ACCOUNT=1 (env-only start)
# ALZA_HTTP_ALLOWED_HOSTS is set to the container's network alias so Host/Origin checks stay on.
set -uo pipefail
export ALZA_TOKEN_FILE=none
npm exec --yes --package=alza-mcp-community -- node -e 0 >/tmp/install.log 2>&1 || { cat /tmp/install.log; exit 1; }
ALZA_HTTP_ALLOWED_HOSTS="$HTTP_ALIAS,localhost,127.0.0.1" npx -y alza-mcp-community --http --port 3000 --host 0.0.0.0 >/tmp/s3000.log 2>&1 &
npx -y alza-mcp-community --http --port 3001 >/tmp/s3001.log 2>&1 &
ALZA_TRANSPORT=http ALZA_HTTP_PORT=3002 ALZA_HTTP_HOST=0.0.0.0 ALZA_HTTP_ENABLE_ACCOUNT=1 \
  ALZA_HTTP_ALLOWED_HOSTS="$HTTP_ALIAS" npx -y alza-mcp-community >/tmp/s3002.log 2>&1 &
for p in 3000 3001 3002; do
  for _ in $(seq 1 60); do node -e "fetch('http://127.0.0.1:$p/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break; sleep 1; done
done
# In-container check of the loopback-only server (the other container must NOT reach it).
node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>r.json()).then(j=>console.log('LOOPBACK_3001 '+JSON.stringify(j)))"
echo HTTP_SERVERS_READY
wait
