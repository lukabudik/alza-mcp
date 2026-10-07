import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Start the real entrypoint (stdio mode) and return how it ended. A valid
 * configuration would keep the process waiting on stdin, so the timeout is the
 * "it started" signal; an invalid ALZA_PROXY_URL must exit on its own. */
function startServer(proxy: string) {
  return spawnSync(process.execPath, ["--import", "tsx", path.join(root, "src", "index.ts")], {
    cwd: root,
    env: { ...process.env, ALZA_TOKEN_FILE: "none", ALZA_CF_TRANSPORT: "0", ALZA_PROXY_URL: proxy },
    input: "",
    encoding: "utf8",
    timeout: 20_000,
  });
}

describe("#69: invalid ALZA_PROXY_URL fails fast at startup", () => {
  for (const [proxy, message] of [
    ["ftp://x:1", /scheme ftp: is not supported/],
    [":::", /not a valid URL/],
    ["http://bob:100%@h:1", /invalid percent-escape/],
  ] as const) {
    it(`exits 1 with a one-line message for ${JSON.stringify(proxy)}`, () => {
      const run = startServer(proxy);
      expect(run.error).toBeUndefined();
      expect(run.status).toBe(1);
      const lines = run.stderr.trim().split("\n");
      expect(lines.at(-1)).toMatch(/^alza-mcp-community: ALZA_PROXY_URL /);
      expect(lines.at(-1)).toMatch(message);
      expect(run.stderr).not.toMatch(/alza-mcp-community ready/);
    }, 30_000);
  }
});
