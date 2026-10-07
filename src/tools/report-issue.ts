import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildIssueDraft, ISSUE_REPO, type Diagnostics, type RecentErrors } from "../infra/issue-report.js";
import type { ToolResult } from "./types.js";

const inputSchema = {
  category: z
    .enum(["bug", "alza_change", "feature_request", "docs"])
    .describe("bug = alza-mcp-community misbehaves; alza_change = Alza changed a page/endpoint and a tool broke; feature_request = something the tools can't do yet; docs = wrong or missing documentation."),
  title: z.string().trim().min(5).max(150).describe("One-line summary, e.g. \"get_product returns no specs for PSU pages\"."),
  what_happened: z.string().trim().min(10).max(4000).describe("What went wrong, including the exact error text. No personal data: credentials, emails, phone numbers and account ids are redacted automatically, but leave out names and addresses."),
  tool: z.string().trim().max(60).optional().describe("The alza-mcp-community tool involved, e.g. \"search_products\"."),
  steps: z.array(z.string().trim().min(1).max(500)).max(10).optional().describe("Steps to reproduce: tool calls with their arguments, in order."),
  expected: z.string().trim().max(1000).optional().describe("What you expected instead."),
  include_recent_errors: z.boolean().optional().describe("Attach this session's last 5 tool errors (redacted). Default true."),
};

const outputSchema = {
  repo: z.string(),
  title: z.string(),
  labels: z.array(z.string()),
  body: z.string().describe("Markdown issue body, already redacted."),
  gh_search_command: z.string().describe("Run first to look for an existing issue about the same problem."),
  gh_create_command: z.string().describe("Files the issue with the GitHub CLI from the user's account (body passed via heredoc)."),
  new_issue_url: z.string().describe("Prefilled GitHub new-issue page, for agents without a shell or `gh`."),
  url_body_truncated: z.boolean(),
  redactions: z.number().int().describe("How many credential / personal-data matches were replaced."),
  recent_errors_included: z.number().int(),
};

export interface ReportIssueContext {
  recentErrors: RecentErrors;
  diagnostics: () => Diagnostics;
}

/** Registered outside the toolsets (like `list_toolsets`) so it is always available. */
export function registerReportIssueTool(
  server: McpServer,
  errorWrap: (name: string, fn: () => Promise<ToolResult>) => Promise<ToolResult>,
  ctx: ReportIssueContext,
): RegisteredTool {
  const name = "report_issue";
  return server.registerTool(
    name,
    {
      title: "Draft a GitHub issue about alza-mcp-community",
      description:
        `Draft a bug report or feature request for the alza-mcp-community project (github.com/${ISSUE_REPO}). ` +
        "Use it when a tool fails unexpectedly, returns data that is clearly wrong, Alza changed something and a tool broke, or the user needs something no tool can do. Not for the user's own mistakes (invalid arguments, a product that doesn't exist) or for problems with an Alza order — those go to Alza support. " +
        "This tool files nothing: it returns a redacted Markdown draft with version and environment details and this session's recent tool errors, a `gh` command to search for duplicates, a `gh issue create` command, and a prefilled new-issue link. " +
        "Then: show the user the title and body and ask before filing, since it is posted publicly from their GitHub account. If they agree and you can run shell commands with an authenticated GitHub CLI, run `gh_search_command` first and, if nothing matches, `gh_create_command`; otherwise give them `new_issue_url`.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      errorWrap(name, async () => {
        const draft = buildIssueDraft(args, ctx.diagnostics(), ctx.recentErrors.list());
        const text = [
          `Draft issue for ${draft.repo} (labels: ${draft.labels.join(", ")}; ${draft.redactions} redaction(s)). Show it to the user and file it only with their consent.`,
          "",
          `Title: ${draft.title}`,
          "",
          draft.body,
          "",
          "Check for duplicates:",
          "```bash",
          draft.gh_search_command,
          "```",
          "File with the GitHub CLI:",
          "```bash",
          draft.gh_create_command,
          "```",
          `Or open: ${draft.new_issue_url}${draft.url_body_truncated ? " (body truncated to fit the URL)" : ""}`,
        ].join("\n");
        return { content: [{ type: "text", text }], structuredContent: { ...draft } };
      }),
  );
}
