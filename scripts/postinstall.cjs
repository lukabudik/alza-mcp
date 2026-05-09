// Triggered automatically when alza-mcp is installed (incl. via `npx -y`).
// Downloads the Chromium headless-shell binary that the MCP server needs.
//
// Skip cases:
//   - ALZA_MCP_SKIP_INSTALL=1     (CI / Docker images that pre-stage browsers)
//   - PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
//   - Running inside this repo's own dev install (lifecycle event from the
//     repo root, not a downstream consumer) — we let `npm run validate:api`
//     or the user trigger it manually.
//
// We use chromium *headless-shell* (~92 MB) instead of full Chromium (~280 MB)
// since the MCP server is always headless.

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

if (process.env.ALZA_MCP_SKIP_INSTALL === "1") {
  process.exit(0);
}
if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") {
  process.exit(0);
}

// Locate playwright's CLI. The `cli.js` file is not in the package's
// `exports` map, so we resolve via package.json instead.
let cliPath;
try {
  const pkgJsonPath = require.resolve("playwright/package.json");
  cliPath = path.join(path.dirname(pkgJsonPath), "cli.js");
  if (!fs.existsSync(cliPath)) throw new Error("cli.js missing");
} catch {
  console.warn(
    "[alza-mcp] postinstall: playwright not yet installed; skipping browser download. " +
      "Run `npx playwright install chromium --only-shell` manually if the server fails to launch."
  );
  process.exit(0);
}

const logFile = path.join(__dirname, "..", ".postinstall.log");

function log(msg) {
  process.stdout.write("[alza-mcp] " + msg + "\n");
  try { fs.appendFileSync(logFile, msg + "\n"); } catch { /* ignore */ }
}

log("downloading chromium headless-shell (~92 MB) for the browser-driven MCP …");
const result = spawnSync(
  process.execPath,
  [cliPath, "install", "chromium", "--only-shell"],
  { stdio: "inherit" }
);

if (result.status === 0) {
  log("chromium headless-shell installed.");
  process.exit(0);
}

// Don't fail the parent npm install over this — alza-mcp will retry the install
// at runtime with a clearer error message.
log(
  "chromium install exited with code " +
    result.status +
    ". The MCP will retry on first launch and explain what to do if it still fails."
);
process.exit(0);
