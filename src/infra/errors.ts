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
    super(`${what} not found`);
  }
}

export class HandshakeError extends AlzaError {
  override readonly name = "HandshakeError";
  constructor(message: string, cause?: unknown) {
    super(`Handshake failed: ${message}`, cause);
  }
}
