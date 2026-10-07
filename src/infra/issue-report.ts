/**
 * Drafting GitHub issues about alza-mcp-community itself (the `report_issue` tool).
 *
 * The server never files anything: it builds a redacted draft plus a ready-to-run
 * `gh issue create` command and a prefilled new-issue URL. The agent shows the draft
 * to the user and files it only with their consent — `gh` posts from the user's own
 * GitHub account, so that decision stays with them.
 */

export const ISSUE_REPO = "lukabudik/alza-mcp-community";

export type IssueCategory = "bug" | "alza_change" | "feature_request" | "docs";

/** Labels that exist in the repository (`gh issue create --label` fails on unknown ones). */
const LABELS: Record<IssueCategory, string[]> = {
  bug: ["bug"],
  alza_change: ["endpoint-broken"],
  feature_request: ["enhancement"],
  docs: ["documentation"],
};

const TITLE_PREFIX: Record<IssueCategory, string> = {
  bug: "",
  alza_change: "Endpoint broken: ",
  feature_request: "",
  docs: "Docs: ",
};

export interface RecordedError {
  tool: string;
  message: string;
  at: string;
}

/** Bounded per-server log of recent tool errors, attached to drafts as context. */
export class RecentErrors {
  private readonly items: RecordedError[] = [];
  constructor(private readonly max = 10) {}

  record(tool: string, message: string, at: Date = new Date()): void {
    this.items.push({ tool, message, at: at.toISOString() });
    if (this.items.length > this.max) this.items.shift();
  }

  list(): RecordedError[] {
    return [...this.items];
  }
}

type Redaction = [RegExp, string, ((match: string) => boolean)?];

/** A header/JSON/query value: a quoted string (spaces allowed) or a bare token. */
const VALUE = `(?:"[^"]*"|'[^']*'|[^\\s"'&,}]+)`;

/** Query parameters whose values are harmless and useful in a bug report. */
const SAFE_QUERY_KEYS = new Set([
  "country", "lang", "language", "locale", "culture", "page", "pagesize", "limit", "offset", "sort", "order",
  "scope", "v", "version", "format", "type", "currency",
]);

const REDACTIONS: Redaction[] = [
  // Credentials embedded in a URL (https://user:pass@host) — before the e-mail rule can mangle them.
  [/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@?#]+@/g, "$1<redacted>@"],
  // Cookie headers carry session ids and the Cloudflare clearance.
  [/\b((?:Set-)?Cookie["']?\s*:\s*)[^\n]+/gi, "$1<redacted>"],
  [/\b(cf_clearance|__cf_bm|__cfduid|phpsessid|jsessionid|asp\.net_sessionid)(\s*=\s*)[^\s;,"']+/gi, "$1$2<redacted>"],
  // Authorization headers of any scheme (Basic, Bearer, Digest, custom).
  [/\b(Authorization["']?\s*[:=]\s*["']?)(?:(Basic|Bearer|Digest|Token)\s+)?[^\s"',}]+/gi, "$1$2 <redacted>"],
  // Secrets by key name, in query strings, JSON or headers.
  [
    new RegExp(
      `\\b(access_token|refresh_token|id_token|client_secret|code_verifier|password|confirmation_token|api[_-]?key|x-api-key|token|sid|sessionid|session_id|secret|visitor(?:_?id)?|user_?id|invoice_?number|commodity_?client_?id)(["']?\\s*[:=]\\s*)${VALUE}`,
      "gi",
    ),
    "$1$2<redacted>",
  ],
  // OAuth redirect parameters (alza://identity?code=…&state=…, also in the #fragment).
  [/([?&#](?:code|state|session_state)=)[^\s&#"']+/g, "$1<redacted>"],
  // A bare `code=`/`state=` is usually a product code worth keeping; only long (OAuth-sized) values go.
  [/(?<![\w?&#])((?:code|state|session_state)=)[^\s&#"']{16,}/g, "$1<redacted>"],
  // Bearer tokens (any case; lowercase prose like "bearer of" is kept unless a long token follows).
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>", (m) => /^Bearer/.test(m) || m.split(/\s+/)[1]!.length >= 8],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<jwt>"],
  // E-mail addresses, Unicode-aware and including the %40-encoded form seen in URLs.
  [/[\p{L}\p{N}._%+-]+(?:@|%40)[\p{L}\p{N}.-]+\.\p{L}{2,}/giu, "<email>"],
  // Phone numbers with an international prefix (+420 123 456 789, +421123456789).
  [/(?:\+|(?<![\w.\/=+-])00)\d{1,3}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3,4}\b/g, "<phone>"],
  // Local 9-digit phone numbers, spaced (777 123 456) or contiguous (777123456).
  [/(?<![\w.\/=+-])\d{3}[ -]\d{3}[ -]\d{3}(?![\w.-])/g, "<phone>"],
  [/(?<![\w.\/=+-])[2-9]\d{8}(?![\w.-])/g, "<phone>"],
  // Account-scoped ids in API paths (/users/123456/…, /orders/987654321).
  [/\/(users|user|customers|orders|order|addresses|claims)\/[^/\s?#]+/gi, "/$1/<id>"],
  // UUIDs (visitor ids, session ids).
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  // Long opaque tokens (hex / base64url, 32+ chars) such as visitor ids or session keys.
  [/\b[A-Fa-f0-9]{32,}\b/g, "<hex>"],
  // Mixed-case + digits tells a secret apart from a long lowercase product URL slug.
  [/\b[A-Za-z0-9_-]{40,}\b/g, "<token>", (m) => /[A-Z].*[A-Z].*[A-Z]/.test(m) && /\d.*\d.*\d/.test(m)],
  // Local home-directory paths leak the OS username.
  [/(\/home\/|\/Users\/|C:\\Users\\)[^/\\\s]+/g, "$1<user>"],
];

/** Redacts every query/fragment value except an allowlist of harmless keys (search terms, ids, tokens). */
function redactQueryValues(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(/([?#])([^\s"'<>]*=[^\s"'<>]*)/g, (_m, lead: string, rest: string) => {
    const parts = rest.split("&").map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return pair;
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value || value.startsWith("<") || SAFE_QUERY_KEYS.has(key.toLowerCase())) return pair;
      count++;
      return `${key}=<redacted>`;
    });
    return lead + parts.join("&");
  });
  return { text: out, count };
}

/** Removes credentials and personal data from free text before it goes into a public issue. */
export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [re, replacement, when] of REDACTIONS) {
    out = out.replace(re, (...m: unknown[]) => {
      const match = String(m[0]);
      if (when && !when(match)) return match;
      count++;
      return replacement.replace(/\$(\d)/g, (_, i: string) => String(m[Number(i)] ?? ""));
    });
  }
  const q = redactQueryValues(out);
  return { text: q.text, count: count + q.count };
}

/**
 * Reduces a recorded tool error to what a maintainer needs: the method/route and status, without
 * query strings (search terms, visitor ids) or upstream HTML bodies (Cloudflare challenge pages).
 */
export function summarizeError(message: string): string {
  return message
    .replace(/<!doctype[\s\S]*|<html[\s\S]*/i, "[HTML body omitted]")
    .replace(/\?[^\s"'<>]*/g, "?<query>")
    .replace(/\s+/g, " ")
    .trim();
}

export interface IssueInput {
  category: IssueCategory;
  title: string;
  what_happened: string;
  tool?: string;
  expected?: string;
  steps?: string[];
  include_recent_errors?: boolean;
}

export interface Diagnostics {
  version: string;
  node: string;
  platform: string;
  storefront: string;
  transport: string;
  fingerprintSidecar: string;
  /** Whether ALZA_PROXY_URL is set — never the URL itself (it can carry credentials). */
  proxy: string;
}

export interface IssueDraft {
  repo: string;
  title: string;
  labels: string[];
  body: string;
  gh_search_command: string;
  gh_create_command: string;
  new_issue_url: string;
  url_body_truncated: boolean;
  redactions: number;
  recent_errors_included: number;
}

/** Quotes a value for a POSIX shell (single quotes; embedded quotes closed and escaped). */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const HEREDOC = "ALZA_MCP_ISSUE_BODY";
// GitHub rejects very long new-issue URLs; keep a margin under ~8 KB.
const MAX_URL = 7000;

export function buildIssueDraft(input: IssueInput, diag: Diagnostics, recent: RecordedError[]): IssueDraft {
  let redactions = 0;
  const clean = (s: string) => {
    const r = redact(s);
    redactions += r.count;
    return r.text.trim();
  };

  const title = clean(TITLE_PREFIX[input.category] + input.title).slice(0, 200);
  const errors = input.include_recent_errors === false ? [] : recent.slice(-5);

  const sections: string[] = [];
  sections.push("**What happened?**", "", clean(input.what_happened));
  if (input.tool) sections.push("", `**Tool:** \`${clean(input.tool)}\``);
  if (input.steps?.length) {
    sections.push("", "**Steps to reproduce**", "", ...input.steps.map((s, i) => `${i + 1}. ${clean(s)}`));
  }
  if (input.expected) sections.push("", "**Expected behavior**", "", clean(input.expected));
  sections.push(
    "",
    "**Environment**",
    "",
    `- alza-mcp-community version: ${diag.version}`,
    `- Node version: ${diag.node}`,
    `- Platform: ${diag.platform}`,
    `- Storefront (\`ALZA_BASE_URL\`): ${diag.storefront}`,
    `- Transport: ${diag.transport}`,
    `- Chrome-fingerprint sidecar: ${diag.fingerprintSidecar}`,
    `- Proxy (\`ALZA_PROXY_URL\`): ${diag.proxy}`,
  );
  if (errors.length) {
    sections.push(
      "",
      "**Recent tool errors in this session**",
      "",
      "```",
      ...errors.map((e) => `${e.at} ${e.tool}: ${clean(summarizeError(e.message)).slice(0, 500)}`),
      "```",
    );
  }
  sections.push("", "_Drafted by the alza-mcp-community `report_issue` tool and reviewed by the user before filing. Personal data and credentials were redacted automatically._");
  let body = sections.join("\n");
  // The heredoc delimiter must not appear in the body itself.
  body = body.split(HEREDOC).join("ALZA_MCP_ISSUE_BODY_");

  const labels = LABELS[input.category];
  const searchTerms = title.replace(/^(Endpoint broken|Docs): /, "").replace(/[^\p{L}\p{N}_ -]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const gh_search_command = `gh issue list --repo ${ISSUE_REPO} --state all --search ${shellQuote(searchTerms)}`;
  const gh_create_command =
    `gh issue create --repo ${ISSUE_REPO} --title ${shellQuote(title)}` +
    labels.map((l) => ` --label ${shellQuote(l)}`).join("") +
    ` --body-file - <<'${HEREDOC}'\n${body}\n${HEREDOC}`;

  const base = `https://github.com/${ISSUE_REPO}/issues/new`;
  const urlFor = (b: string) => `${base}?${new URLSearchParams({ title, labels: labels.join(","), body: b })}`;
  let new_issue_url = urlFor(body);
  let url_body_truncated = false;
  if (new_issue_url.length > MAX_URL) {
    url_body_truncated = true;
    const note = "\n\n_(Truncated to fit a URL — run the `gh issue create` command for the full report.)_";
    let lo = 0;
    let hi = body.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (urlFor(body.slice(0, mid) + note).length <= MAX_URL) lo = mid;
      else hi = mid - 1;
    }
    new_issue_url = urlFor(body.slice(0, lo) + note);
  }

  return {
    repo: ISSUE_REPO,
    title,
    labels,
    body,
    gh_search_command,
    gh_create_command,
    new_issue_url,
    url_body_truncated,
    redactions,
    recent_errors_included: errors.length,
  };
}
