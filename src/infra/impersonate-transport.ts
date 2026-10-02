import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";

/**
 * Chrome-fingerprint HTTP transport (Cloudflare Bot Management bypass).
 *
 * Alza's surfaces answer plain Node fetches with a 403 managed challenge,
 * but accept a Chrome-like TLS/HTTP2/header fingerprint (verified
 * 2026-09-15 from this host: www, webapi, identity — 5/5 fresh sessions,
 * authenticated calls included). The fingerprint comes from a small
 * Python/curl_cffi sidecar (scripts/cf-transport.py) speaking line-JSON
 * over stdio; this class is the Node client.
 *
 * Optional by design: if no suitable Python interpreter is found, or the
 * sidecar dies, `available` flips to false and callers fall back to the
 * existing chain (plain fetch → browser transport).
 */

export interface CfResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface CfRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string | null;
  timeoutMs?: number;
}

export class TransportUnavailableError extends Error {
  constructor(reason: string) {
    super(`Chrome-fingerprint transport unavailable: ${reason}`);
    this.name = "TransportUnavailableError";
  }
}

interface Pending {
  resolve: (r: CfResponse) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Candidate interpreters, in priority order (first that imports curl_cffi wins). */
export function candidatePythons(): string[] {
  const cands: string[] = [];
  if (process.env.ALZA_CF_PYTHON) cands.push(process.env.ALZA_CF_PYTHON);
  cands.push(path.join(repoRoot, ".venv-cf", "bin", "python"));
  cands.push("python3");
  return [...new Set(cands)];
}

function verifyPython(cmd: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, ["-c", "import curl_cffi"], { timeout: timeoutMs }, (err) => {
      resolve(!err);
    });
  });
}

export class ImpersonateTransport {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private lineBuf = "";
  private dead = false;
  private spawnPromise: Promise<boolean> | null = null;
  private stderrTail = "";

  constructor(
    private readonly opts: {
      scriptPath?: string;
      profile?: string;
      timeoutMs?: number;
      enabled?: boolean;
    } = {}
  ) {}

  get scriptPath(): string {
    return this.opts.scriptPath ?? path.join(repoRoot, "scripts", "cf-transport.py");
  }

  get available(): boolean {
    return (this.opts.enabled ?? process.env.ALZA_CF_TRANSPORT !== "0") && !this.dead;
  }

  /** Spawn (once) and verify the sidecar can import curl_cffi. */
  private async ensureStarted(): Promise<boolean> {
    if (this.child && this.child.exitCode === null) return true;
    if (this.spawnPromise) return this.spawnPromise;
    this.spawnPromise = (async () => {
      if (!existsSync(this.scriptPath)) {
        this.dead = true;
        log.warn("cf-transport: script missing", { scriptPath: this.scriptPath });
        return false;
      }
      for (const py of candidatePythons()) {
        if (!(await verifyPython(py))) continue;
        const child = spawn(py, [this.scriptPath], { stdio: ["pipe", "pipe", "pipe"] });
        this.wire(child);
        // Give it a moment to self-destruct on import failure.
        await new Promise((r) => setTimeout(r, 400));
        if (child.exitCode !== null) {
          log.warn("cf-transport: sidecar exited at startup", { py, code: child.exitCode, stderr: this.stderrTail.slice(-300) });
          continue;
        }
        this.child = child;
        log.info("cf-transport: sidecar ready", { py, pid: child.pid });
        return true;
      }
      this.dead = true;
      log.warn("cf-transport: no interpreter with curl_cffi found (run scripts/ensure-cf-venv.sh)");
      return false;
    })();
    return this.spawnPromise;
  }

  private wire(child: ChildProcess): void {
    child.stdout?.on("data", (chunk: Buffer) => {
      this.lineBuf += chunk.toString();
      let nl: number;
      while ((nl = this.lineBuf.indexOf("\n")) >= 0) {
        const line = this.lineBuf.slice(0, nl).trim();
        this.lineBuf = this.lineBuf.slice(nl + 1);
        if (line) this.dispatch(line);
      }
    });
    child.stderr?.on("data", (c: Buffer) => {
      this.stderrTail = (this.stderrTail + c.toString()).slice(-2000);
    });
    child.on("error", (err) => {
      log.warn("cf-transport: child error", { error: String(err) });
      this.killAll(new TransportUnavailableError(String(err)));
    });
    child.on("exit", (code) => {
      log.warn("cf-transport: sidecar exited", { code });
      this.killAll(new TransportUnavailableError(`sidecar exited (${code})`));
    });
  }

  private dispatch(line: string): void {
    let msg: { id?: number; status?: number; headers?: Record<string, string>; body?: string; error?: string | null };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const id = msg.id;
    if (typeof id !== "number") return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (msg.error) {
      p.reject(new Error(`cf-transport: ${msg.error}`));
      return;
    }
    p.resolve({
      status: msg.status ?? 0,
      headers: msg.headers ?? {},
      body: Buffer.from(msg.body ?? "", "base64"),
    });
  }

  private killAll(err: Error): void {
    this.dead = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  async request(req: CfRequest): Promise<CfResponse> {
    if (!this.available) throw new TransportUnavailableError("disabled or dead");
    const started = await this.ensureStarted();
    if (!started || !this.child) throw new TransportUnavailableError("spawn failed");
    const child = this.child;
    const id = this.nextId++;
    const bodyB64 = req.body ? Buffer.from(req.body).toString("base64") : "";
    const line =
      JSON.stringify({
        id,
        url: req.url,
        method: req.method ?? "GET",
        headers: req.headers ?? {},
        body: bodyB64,
        impersonate: this.opts.profile ?? "chrome",
        timeoutMs: req.timeoutMs ?? this.opts.timeoutMs ?? 60_000,
      }) + "\n";
    return new Promise<CfResponse>((resolve, reject) => {
      const timeoutMs = req.timeoutMs ?? this.opts.timeoutMs ?? 60_000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cf-transport: request timed out after ${timeoutMs}ms`));
      }, timeoutMs + 5_000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin?.write(line, (err) => {
        if (err && this.pending.has(id)) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  close(): void {
    this.killAll(new TransportUnavailableError("transport closed"));
    this.child?.kill();
    this.child = null;
  }
}

/**
 * A `fetch`-shaped adapter over the sidecar so it can be injected wherever
 * the codebase already accepts a `fetchImpl` (AppActionExecutor) or used
 * directly (MobileApi).
 */
export class CfResponseAdapter {
  constructor(private readonly r: CfResponse) {}

  get status(): number {
    return this.r.status;
  }

  get ok(): boolean {
    return this.r.status >= 200 && this.r.status < 300;
  }

  /** Headers view satisfying the FetchLike contract (`headers.get`). */
  get headers() {
    const h = this.r.headers;
    return {
      get: (name: string) => h[name.toLowerCase()] ?? null,
      getSetCookie: () => {
        const v = h["set-cookie"];
        return v ? v.split(/,(?=[^]*[=;])/).map((c) => c.trim()) : [];
      },
    };
  }

  header(name: string): string | null {
    return this.r.headers[name.toLowerCase()] ?? null;
  }

  async text(): Promise<string> {
    return this.r.body.toString("utf8");
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.r.body.buffer.slice(this.r.body.byteOffset, this.r.body.byteOffset + this.r.body.byteLength) as ArrayBuffer;
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.r.body.toString("utf8"));
  }
}

/** fetch(url, init) via the sidecar. Satisfies both
 * `MobileApiOptions.httpFetch` and `AppActionExecutorOptions.fetchImpl`
 * (the minimal FetchLike contract in app-action.ts).
 * Non-string bodies (FormData/Blob/streams — e.g. multipart upload actions)
 * stay on the native fetch path: the sidecar speaks raw base64 bytes. */
export function cfFetch(transport: ImpersonateTransport) {
  return async (input: string | URL | Request, init: RequestInit = {}): Promise<CfResponseAdapter | Response> => {
    const body = init.body;
    if (body != null && typeof body !== "string") {
      return fetch(String(input), init);
    }
    const headers: Record<string, string> = {};
    const h = init.headers;
    if (h instanceof Headers) {
      for (const [k, v] of h.entries()) headers[k] = v;
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) if (k && v) headers[k] = v;
    } else if (h) {
      Object.assign(headers, h);
    }
    const res = await transport.request({
      url: String(input),
      method: init.method,
      headers,
      body: (typeof body === "string" ? body : null),
    });
    return new CfResponseAdapter(res);
  };
}
