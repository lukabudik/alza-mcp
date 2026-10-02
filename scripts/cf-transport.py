#!/usr/bin/env python3
"""Chrome-fingerprint HTTP transport for alza-mcp (Cloudflare Bot Management bypass).

Alza's surfaces (www / webapi / identity) 403 plain Node fetches with a
Cloudflare managed challenge, but accept a Chrome-like TLS/HTTP2/header
fingerprint (verified 2026-09-15, residential IP, 5/5 fresh sessions).
This sidecar provides that fingerprint to the Node server over stdio:

  request line:  {"id":1,"url":"https://…","method":"GET","headers":{…},
                  "body":"<base64>","impersonate":"chrome","timeoutMs":60000}
  response line: {"id":1,"status":200,"headers":{…},"body":"<base64>","error":null}

Body is base64 in both directions (binary-safe). One long-lived process;
requests are multiplexed by `id`. Exit codes: 0 normal, 1 startup failure.
"""
import base64
import json
import sys
import threading

try:
    from curl_cffi import requests as cffi_requests
except ImportError:  # pragma: no cover - reported on stderr, then exit
    sys.stderr.write("cf-transport: curl_cffi not importable\n")
    sys.exit(1)

_sessions: dict[str, object] = {}
_lock = threading.Lock()


def get_session(profile: str):
    with _lock:
        s = _sessions.get(profile)
        if s is None:
            s = cffi_requests.Session(impersonate=profile)
            _sessions[profile] = s
        return s


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            url = req.get("url")
            method = (req.get("method") or "GET").upper()
            headers = req.get("headers") or {}
            body = base64.b64decode(req["body"]) if req.get("body") else None
            profile = req.get("impersonate") or "chrome"
            timeout = float(req.get("timeoutMs") or 60000) / 1000.0
            r = get_session(profile).request(
                method, url, headers=headers, content=body, timeout=timeout
            )
            out = {
                "id": rid,
                "status": r.status_code,
                "headers": {k.lower(): v for k, v in r.headers.items()},
                "body": base64.b64encode(r.content or b"").decode("ascii"),
                "error": None,
            }
        except Exception as e:  # noqa: BLE001 - report, keep the transport alive
            out = {
                "id": rid,
                "status": 0,
                "headers": {},
                "body": "",
                "error": f"{type(e).__name__}: {e}",
            }
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
