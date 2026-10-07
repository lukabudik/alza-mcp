#!/usr/bin/env python3
"""Chrome-fingerprint HTTP transport for alza-mcp-community (Cloudflare Bot Management bypass).

Alza's surfaces (www / webapi / identity) 403 plain Node fetches with a
Cloudflare managed challenge, but accept a Chrome-like TLS/HTTP2/header
fingerprint (verified 2026-09-15, residential IP, 5/5 fresh sessions).
This sidecar provides that fingerprint to the Node server over stdio:

  request line:  {"id":1,"url":"https://…","method":"GET","headers":{…},
                  "body":"<base64>","impersonate":"chrome","timeoutMs":60000,
                  "followRedirects":true}
  response line: {"id":1,"status":200,"headers":{…},"body":"<base64>","error":null}

Body is base64 in both directions (binary-safe). `followRedirects` defaults to
true; false returns a 3xx response as-is (status + `location` header) so the
caller can validate the target before following it (fetch's redirect:"manual").

One long-lived process. Requests run concurrently on a bounded thread pool
(MAX_CONCURRENCY workers; more are queued), so one slow upstream call does not
hold up the others. Responses are written whole, one line each, in completion
order, and matched to their request by `id`. Exit codes: 0 normal, 1 startup failure.
"""
import base64
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

try:
    from curl_cffi import requests as cffi_requests
except ImportError:  # pragma: no cover - reported on stderr, then exit
    sys.stderr.write("cf-transport: curl_cffi not importable\n")
    sys.exit(1)

_sessions: dict[str, object] = {}
_lock = threading.Lock()
_write_lock = threading.Lock()
# Bounded so a burst of tool calls cannot open an unbounded number of upstream
# connections from one IP (Cloudflare rate limits per client).
MAX_CONCURRENCY = 8


def get_session(profile: str):
    with _lock:
        s = _sessions.get(profile)
        if s is None:
            # ALZA_PROXY_URL (http/https/socks5, optional user:pass@): same proxy as the
            # managed Chromium, e.g. a residential exit when this host's IP is challenged.
            proxy = (os.environ.get("ALZA_PROXY_URL") or "").strip() or None
            # curl_cffi Sessions use a thread-local curl handle, so one Session (and
            # its cookie jar) is shared by the worker threads.
            s = cffi_requests.Session(impersonate=profile, proxy=proxy)
            _sessions[profile] = s
        return s


def handle(line: str) -> dict:
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
        follow = req.get("followRedirects") is not False
        r = get_session(profile).request(
            method,
            url,
            headers=headers,
            content=body,
            timeout=timeout,
            allow_redirects=follow,
        )
        return {
            "id": rid,
            "status": r.status_code,
            "headers": {k.lower(): v for k, v in r.headers.items()},
            "body": base64.b64encode(r.content or b"").decode("ascii"),
            "error": None,
        }
    except Exception as e:  # noqa: BLE001 - report, keep the transport alive
        return {
            "id": rid,
            "status": 0,
            "headers": {},
            "body": "",
            "error": f"{type(e).__name__}: {e}",
        }


def respond(line: str) -> None:
    out = json.dumps(handle(line)) + "\n"
    with _write_lock:
        sys.stdout.write(out)
        sys.stdout.flush()


def main() -> None:
    pool = ThreadPoolExecutor(max_workers=MAX_CONCURRENCY, thread_name_prefix="cf")
    try:
        for line in sys.stdin:
            line = line.strip()
            if line:
                pool.submit(respond, line)
    finally:
        # stdin closed: the parent is gone or shutting down. Drop queued work;
        # requests already running finish within their own timeouts.
        pool.shutdown(wait=True, cancel_futures=True)


if __name__ == "__main__":
    main()
