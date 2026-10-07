import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";

let mockSpawnHandler: (...args: any[]) => any;

vi.mock("node:child_process", () => ({
  spawn: vi.fn((...args: any[]) => mockSpawnHandler(...args)),
}));

import { ensureChromiumInstalled } from "../src/infra/browser.js";
import { spawn } from "node:child_process";

describe("ensureChromiumInstalled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawns playwright install with stdio redirecting to stderr so MCP stdout stream is preserved", async () => {
    const mockChild = new EventEmitter() as any;
    mockSpawnHandler = vi.fn(() => {
      process.nextTick(() => mockChild.emit("exit", 0));
      return mockChild;
    });

    await ensureChromiumInstalled();

    expect(spawn).toHaveBeenCalledTimes(1);
    const [, args, options] = (spawn as any).mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(["install", "chromium", "--only-shell"]));
    expect(options?.stdio).toEqual(["ignore", 2, 2]);
  });

  it("rejects when the install process exits with a non-zero exit code", async () => {
    const mockChild = new EventEmitter() as any;
    mockSpawnHandler = vi.fn(() => {
      process.nextTick(() => mockChild.emit("exit", 1));
      return mockChild;
    });

    await expect(ensureChromiumInstalled()).rejects.toThrow(
      /Failed to install Chromium \(exit 1\)/
    );
  });

  it("rejects when the spawned child process emits an error event", async () => {
    const mockChild = new EventEmitter() as any;
    mockSpawnHandler = vi.fn(() => {
      process.nextTick(() => mockChild.emit("error", new Error("spawn ENOENT")));
      return mockChild;
    });

    await expect(ensureChromiumInstalled()).rejects.toThrow("spawn ENOENT");
  });
});
