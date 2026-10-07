export class AlzaError extends Error {
  override readonly name: string = "AlzaError";
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export class CloudflareChallengeError extends AlzaError {
  override readonly name = "CloudflareChallengeError";
  constructor(message = "Cloudflare bot-challenge intercepted the request. Try again later or set ALZA_PROXY_URL.") {
    super(message);
  }
}

export class UpstreamError extends AlzaError {
  override readonly name = "UpstreamError";
  constructor(public readonly status: number, message: string, cause?: unknown) {
    super(`Alza upstream returned ${status}: ${message}`, cause);
  }
}

export class NotFoundError extends AlzaError {
  override readonly name = "NotFoundError";
  constructor(what: string) {
    super(`${truncateInput(what, 120)} not found`);
  }
}

export class HandshakeError extends AlzaError {
  override readonly name = "HandshakeError";
  constructor(message: string, cause?: unknown) {
    super(`Handshake failed: ${message}`, cause);
  }
}

/** Bad operator configuration (e.g. an invalid ALZA_PROXY_URL). Not a bug in
 * alza-mcp-community or a change on Alza's side, so no `report_issue` hint. */
export class ConfigurationError extends AlzaError {
  override readonly name = "ConfigurationError";
}

/** The access token was rejected (or Alza answered as an anonymous visitor)
 * and could not be renewed. */
export class AuthenticationError extends AlzaError {
  override readonly name = "AuthenticationError";
}

/** A non-idempotent request (POST/PUT/PATCH/DELETE) failed after it was handed
 * to the transport: it may or may not have reached Alza, so it is never
 * replayed automatically. */
export class OutcomeUnknownError extends AlzaError {
  override readonly name = "OutcomeUnknownError";
  constructor(method: string, target: string, cause: unknown) {
    super(
      `${method} ${target}: the request may or may not have reached Alza — the transport failed after the request was sent (${cause instanceof Error ? cause.message : String(cause)}). ` +
        "It was NOT retried automatically, so nothing was sent twice. Check the current state first (for example `order_archive`, `cart` or `profile`) and only retry if the change is not there.",
      cause,
    );
  }
}

/** Alza answered 2xx with an `err:1` envelope: it refused the request (e.g.
 * "order does not exist"). A user-facing validation, not an alza-mcp-community bug. */
export class AlzaRejectedError extends AlzaError {
  override readonly name = "AlzaRejectedError";
  constructor(public readonly alzaMessage: string | undefined) {
    super(`Alza rejected the request (err:1): ${alzaMessage ?? "no message"}`);
  }
}

/** Throws AlzaRejectedError when `value` is an `{err: 1, msg}` envelope. */
export function assertNotRejected(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const env = value as Record<string, unknown>;
  if (env.err === 1) throw new AlzaRejectedError(typeof env.msg === "string" && env.msg.length > 0 ? env.msg : undefined);
}

/** The request itself is wrong (bad input, invalid confirmation token, not signed in,
 * wrong user_id, unknown postal code). The caller can fix it; not a bug in alza-mcp-community
 * or a change on Alza's side, so no `report_issue` hint. */
export class UserError extends AlzaError {
  override readonly name = "UserError";
}

/** Shorten user-supplied text before echoing it into an error message. */
export function truncateInput(value: unknown, max = 60): string {
  const s = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return s.length > max ? `${s.slice(0, max)}… (${s.length} chars)` : s;
}
