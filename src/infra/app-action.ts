import { URL } from "node:url";

export type AppActionMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AppActionRel = "self" | "collection" | "form" | "create-form" | "edit-form" | "multipart";

export interface AppActionMeta {
  href: string;
  method?: string | null;
  rel?: AppActionRel[] | null;
}

export interface AppActionValue {
  name: string;
  value: unknown;
  kind?: "text" | "integer" | "boolean" | "decimal" | "text-array" | "integer-array";
}

export interface AppActionFilePart {
  /** Form field name for the file part (from the server-provided form values). */
  partName: string;
  fileName: string;
  /** Whitelisted image MIME type. */
  mimeType: string;
  /** `data:<mime>;base64,....` payload. */
  dataUrl: string;
}

export interface AppActionForm {
  meta: AppActionMeta;
  values?: AppActionValue[];
}

export interface ServerAppAction {
  appLink?: string;
  form: AppActionForm;
  enabled?: boolean;
}

/** Minimal fetch contract: the global fetch satisfies it, and so does the
 * Chrome-fingerprint sidecar adapter (CfResponseAdapter). */
export interface FetchLikeResponse {
  status: number;
  ok: boolean;
  headers: {
    get(name: string): string | null;
    getSetCookie?(): string[];
  };
  text(): Promise<string>;
}
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<FetchLikeResponse>;

export interface AppActionExecutorOptions {
  baseUrl: string;
  visitorId: string;
  userId?: number;
  authorizationToken?: string;
  userAgent?: string;
  allowedPathPrefixes?: string[];
  fetchImpl?: FetchLike;
}

export interface ExecuteAppActionOptions {
  allowMutation?: boolean;
  confirmationToken?: string;
  /** Typed user-input values merged into the server-provided form values (user values win on name conflict). */
  extraValues?: AppActionValue[];
  /** Multipart file parts (only for `multipart` rel actions). */
  files?: AppActionFilePart[];
}

const ALLOWED_FILE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/bmp", "image/avif"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const DEFAULT_PATH_PREFIXES = ["/api/", "/services/restservice.svc/"];
const SAFE_METHODS = new Set<AppActionMethod>(["GET", "POST"]);

function relHasMultipart(meta: AppActionMeta): boolean {
  return (meta.rel ?? []).includes("multipart");
}
const MUTATING_METHODS = new Set<AppActionMethod>(["POST", "PUT", "PATCH", "DELETE"]);
const BLOCKED_FIELD = /(?:^|_|-)(?:password|passwd|secret|token|authorization|cookie|refresh|access[_-]?token|card|cvv|cvc|iban|bic|payment|encrypted|client[_-]?secret)(?:$|_|-)/i;

export class AppActionExecutor {
  private readonly fetchImpl: FetchLike;
  private readonly origin: string;
  private readonly pathPrefixes: string[];
  private readonly cookies = new Map<string, string>();

  constructor(private readonly options: AppActionExecutorOptions) {
    const base = new URL(options.baseUrl);
    if (base.protocol !== "https:") throw new Error("AppAction base URL must use HTTPS");
    this.origin = base.origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pathPrefixes = options.allowedPathPrefixes ?? DEFAULT_PATH_PREFIXES;
    if (this.pathPrefixes.length === 0 || this.pathPrefixes.some((p) => !p.startsWith("/"))) {
      throw new Error("AppAction path allowlist is invalid");
    }
  }

  async execute(action: ServerAppAction, options: ExecuteAppActionOptions = {}): Promise<unknown> {
    if (!action || !action.form || !action.form.meta) throw new Error("AppAction form metadata is required");
    if (action.enabled === false) throw new Error("AppAction is disabled");

    let target = this.validateTarget(action.form.meta.href);
    const method = this.resolveMethod(action.form.meta);
    const values = this.normalizedValues([
      ...(action.form.values ?? []),
      { name: "visitorId", value: this.options.visitorId, kind: "text" as const },
      ...(this.options.userId === undefined ? [] : [{ name: "userId", value: this.options.userId, kind: "integer" as const }]),
      ...(options.extraValues ?? []),
    ]);
    if (options.files && options.files.length > 0 && !relHasMultipart(action.form.meta)) {
      throw new Error("File parts require a multipart AppAction (meta.rel must include 'multipart')");
    }
    const hasMutation = MUTATING_METHODS.has(method);
    if (hasMutation && (!options.allowMutation || !options.confirmationToken)) {
      throw new Error("AppAction mutation requires explicit confirmation");
    }

    const isMultipart = relHasMultipart(action.form.meta);
    const init: RequestInit = { method, redirect: "manual", headers: this.headers(isMultipart) };

    if (method === "GET") {
      target = this.addQuery(target, values);
    } else if (isMultipart) {
      init.body = this.multipartBody(values, options.files ?? []);
      (init.headers as Headers).delete("content-type");
    } else {
      init.body = JSON.stringify(this.jsonBody(values));
    }

    let response = await this.requestWithCookies(target, init);
    for (let redirectCount = 0; response.status >= 300 && response.status < 400 && redirectCount < 3; redirectCount += 1) {
      const location = response.headers.get("location");
      if (!location) throw new Error("AppAction redirect has no location");
      target = this.validateTarget(location);
      if (method !== "GET") throw new Error("AppAction mutation redirects are blocked");
      response = await this.requestWithCookies(target, { ...init, method: "GET", body: undefined });
    }
    if (response.status >= 300 && response.status < 400) throw new Error("AppAction redirect limit exceeded");
    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) throw new Error(`AppAction ${method} ${new URL(target).pathname} failed with HTTP ${response.status}`);
    return body;
  }

  private validateTarget(href: string): string {
    if (!href || typeof href !== "string") throw new Error("AppAction href is required");
    const target = new URL(href, this.origin);
    if (target.protocol !== "https:" || target.origin !== this.origin) throw new Error("AppAction href is outside the allowed origin");
    if (!this.pathPrefixes.some((prefix) => target.pathname.startsWith(prefix))) throw new Error("AppAction path is outside the allowlist");
    return target.toString();
  }

  private resolveMethod(meta: AppActionMeta): AppActionMethod {
    const explicit = (meta.method ?? "").toUpperCase();
    const method = explicit || ((meta.rel ?? []).some((rel) => ["form", "create-form", "edit-form", "multipart"].includes(rel)) ? "POST" : "GET");
    if (!SAFE_METHODS.has(method as AppActionMethod)) throw new Error(`AppAction method is not allowed: ${method}`);
    return method as AppActionMethod;
  }

  private normalizedValues(values: AppActionValue[]): AppActionValue[] {
    return values.map((item) => {
      if (!item || typeof item.name !== "string" || !item.name) throw new Error("AppAction value name is required");
      if (BLOCKED_FIELD.test(item.name)) throw new Error(`Sensitive AppAction field is blocked: ${item.name}`);
      return item;
    });
  }

  private addQuery(target: string, values: AppActionValue[]): string {
    const url = new URL(target);
    for (const item of values) {
      const pairs = this.queryPairs(item);
      if (url.searchParams.has(item.name)) url.searchParams.delete(item.name);
      for (const [key, value] of pairs) url.searchParams.append(key, value);
    }
    return url.toString();
  }

  private queryPairs(item: AppActionValue): Array<[string, string]> {
    const value = item.value;
    if (Array.isArray(value)) return value.map((v, index) => [value.length === 1 ? item.name : `${item.name}[${index}]`, this.scalar(v)]);
    return [[item.name, this.scalar(value)]];
  }

  private jsonBody(values: AppActionValue[]): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    for (const item of values) body[item.name] = item.value;
    return body;
  }

  private multipartBody(values: AppActionValue[], files: AppActionFilePart[]): FormData {
    const body = new FormData();
    for (const item of values) {
      if (Array.isArray(item.value)) for (const value of item.value) body.append(item.name, this.scalar(value));
      else body.append(item.name, this.scalar(item.value));
    }
    for (const file of files) {
      if (!file.partName || !file.fileName || !file.dataUrl) throw new Error("File parts need partName, fileName, and dataUrl");
      const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(file.dataUrl);
      if (!match) throw new Error("File part dataUrl must be a base64 data URL");
      if (match[2] !== ";base64") throw new Error("File part dataUrl must be base64-encoded");
      if (file.mimeType && !ALLOWED_FILE_MIME_TYPES.has(file.mimeType)) throw new Error(`File MIME type not allowed: ${file.mimeType}`);
      const b64 = match[3];
      if (typeof b64 !== "string") throw new Error("File part dataUrl must contain base64 payload");
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new Error(`File part size must be 1..${MAX_FILE_BYTES} bytes`);
      const blob = new Blob([new Uint8Array(bytes)], { type: file.mimeType || match[1] || "application/octet-stream" });
      body.append(file.partName, blob, file.fileName);
    }
    return body;
  }

  private scalar(value: unknown): string {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === null || value === undefined) return "";
    if (typeof value === "number" || typeof value === "string") return String(value);
    throw new Error("Unsupported AppAction value type");
  }

  private headers(multipart: boolean): Headers {
    const headers = new Headers({ accept: "application/json", "user-agent": this.options.userAgent ?? "ktor-client", "accept-language": "cs-CZ,cs;q=0.9,en;q=0.8", "Balancer-Guid": this.options.visitorId });
    if (!multipart) headers.set("content-type", "application/json");
    if (this.options.authorizationToken) headers.set("authorization", `Bearer ${this.options.authorizationToken}`);
    return headers;
  }

  private async requestWithCookies(target: string, init: RequestInit): Promise<FetchLikeResponse> {
    const headers = new Headers(init.headers);
    const cookie = [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookie) headers.set("cookie", cookie);
    const response = await this.fetchImpl(target, { ...init, headers });
    const setCookies = (response.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const header of setCookies) {
      const first = header.split(";", 1)[0] ?? "";
      const separator = first.indexOf("=");
      if (separator > 0) this.cookies.set(first.slice(0, separator), first.slice(separator + 1));
    }
    return response;
  }
}
