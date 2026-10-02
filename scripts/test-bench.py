#!/usr/bin/env python3
"""Safe Alza compatibility bench: read-only live checks plus local verification."""
from __future__ import annotations
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("ALZA_API_BASE_URL")
if not BASE:
    raise SystemExit("Set ALZA_API_BASE_URL explicitly; no production fallback is allowed")

# Deliberately reject credential-like configuration for this bench.
for name in os.environ:
    if any(token in name.lower() for token in ("password", "passwd", "secret", "access_token", "refresh_token", "cookie")):
        raise SystemExit(f"Credential-like environment variable is not accepted by the safe bench: {name}")


def run_live(script: str) -> list[dict]:
    env = os.environ.copy()
    env["ALZA_API_BASE_URL"] = BASE
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / script)], cwd=ROOT, env=env, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"{script} failed: {result.stderr[-1000:]}")
    records = []
    for line in result.stdout.splitlines():
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


def run_local(command: list[str]) -> dict:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    return {"command": " ".join(command), "exit_code": result.returncode}

matrix = run_live("live-endpoint-matrix.py")
journeys = run_live("live-user-journeys.py")
local = [
    run_local(["npm", "test"]),
    run_local(["npm", "run", "typecheck"]),
    run_local(["npm", "run", "build"]),
    run_local(["git", "diff", "--check"]),
]

matrix_statuses = [r.get("status") for r in matrix if "status" in r]
journey_steps = [step for journey in journeys for step in journey.get("steps", [])]
journey_statuses = [r.get("status") for r in journey_steps if "status" in r]
print(json.dumps({
    "base_origin": BASE.split("/", 3)[:3],
    "mode": "read-only",
    "matrix": {
        "checks": len(matrix),
        "http_2xx": sum(200 <= s < 300 for s in matrix_statuses),
        "expected_non_2xx": sum(not (200 <= s < 300) for s in matrix_statuses),
        "cloudflare_challenges": sum(bool(r.get("cf_mitigated")) for r in matrix),
    },
    "journeys": {
        "journeys": len(journeys),
        "steps": len(journey_steps),
        "http_2xx": sum(200 <= s < 300 for s in journey_statuses),
        "expected_non_2xx": sum(not (200 <= s < 300) for s in journey_statuses),
        "cloudflare_challenges": sum(bool(r.get("cf_mitigated")) for r in journey_steps),
    },
    "local_verification": local,
    "credentials_used": False,
    "mutations_run": False,
}, ensure_ascii=False))

if any(r["exit_code"] != 0 for r in local):
    raise SystemExit(1)
