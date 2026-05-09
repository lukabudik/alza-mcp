type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): number {
  if (process.env.ALZA_DEBUG === "true" || process.env.ALZA_DEBUG === "1") return LEVELS.debug;
  return LEVELS[(process.env.ALZA_LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < currentLevel()) return;
  const payload = { ts: new Date().toISOString(), level, msg, ...fields };
  // stderr only — stdout is reserved for MCP stdio transport.
  process.stderr.write(JSON.stringify(payload) + "\n");
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
