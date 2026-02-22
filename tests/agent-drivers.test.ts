import { describe, test, expect, afterEach } from "vitest";
import {
  createClaudeCodeDriver,
  BASE_ALLOWED_TOOLS,
} from "../src/agents/claude-code.js";
import { createPiDriver } from "../src/agents/pi.js";
import { createConsoleReporter } from "../src/reporter/console.js";
import type { Sandbox } from "../src/sandbox/types.js";
import type { ExecOptions, ExecResult } from "../contracts/types.js";

function mockSandbox(
  execFn?: (opts: ExecOptions) => Promise<ExecResult>,
): Sandbox {
  return {
    workDir: "/tmp/test",
    exec:
      execFn ??
      (async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          result: "done",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
          session_id: "sess-1",
        }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
      })),
    uploadFiles: async () => {},
    snapshot: async () => "snap",
    teardown: async () => {},
  };
}

describe("ClaudeCodeDriver", () => {
  test("builds correct argv", async () => {
    let capturedArgv: string[] = [];
    const sandbox = mockSandbox(async (opts) => {
      capturedArgv = opts.argv;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          result: "ok",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
        }),
        stderr: "",
        durationMs: 100,
        timedOut: false,
      };
    });
    const driver = createClaudeCodeDriver();
    await driver.execute(sandbox, "do something");
    expect(capturedArgv).toContain("claude");
    expect(capturedArgv).toContain("-p");
    expect(capturedArgv).toContain("--output-format");
    expect(capturedArgv).toContain("json");
    expect(capturedArgv).toContain("do something");
  });

  test("merges allowed tools", async () => {
    let capturedArgv: string[] = [];
    const sandbox = mockSandbox(async (opts) => {
      capturedArgv = opts.argv;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          result: "ok",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
        }),
        stderr: "",
        durationMs: 100,
        timedOut: false,
      };
    });
    const driver = createClaudeCodeDriver();
    await driver.execute(sandbox, "do it", {
      allowedTools: ["WebSearch"],
    });
    const toolsIdx = capturedArgv.indexOf("--allowedTools");
    expect(toolsIdx).toBeGreaterThan(-1);
    const toolsStr = capturedArgv[toolsIdx + 1]!;
    expect(toolsStr).toContain("Read");
    expect(toolsStr).toContain("WebSearch");
  });

  test("passes --append-system-prompt", async () => {
    let capturedArgv: string[] = [];
    const sandbox = mockSandbox(async (opts) => {
      capturedArgv = opts.argv;
      return {
        exitCode: 0,
        stdout: JSON.stringify({ result: "ok", usage: {} }),
        stderr: "",
        durationMs: 100,
        timedOut: false,
      };
    });
    const driver = createClaudeCodeDriver();
    await driver.execute(sandbox, "do it", {
      systemPrompt: "be careful",
    });
    expect(capturedArgv).toContain("--append-system-prompt");
    expect(capturedArgv).toContain("be careful");
  });

  test("passes --resume for session", async () => {
    let capturedArgv: string[] = [];
    const sandbox = mockSandbox(async (opts) => {
      capturedArgv = opts.argv;
      return {
        exitCode: 0,
        stdout: JSON.stringify({ result: "ok", usage: {} }),
        stderr: "",
        durationMs: 100,
        timedOut: false,
      };
    });
    const driver = createClaudeCodeDriver();
    await driver.execute(sandbox, "do it", { sessionId: "sess-abc" });
    expect(capturedArgv).toContain("--resume");
    expect(capturedArgv).toContain("sess-abc");
  });

  test("handles non-zero exit", async () => {
    const sandbox = mockSandbox(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "error occurred",
      durationMs: 100,
      timedOut: false,
    }));
    const driver = createClaudeCodeDriver();
    const result = await driver.execute(sandbox, "do something");
    expect(result.status).toBe("failure");
    expect(result.error).toContain("error occurred");
  });

  test("handles timeout", async () => {
    const sandbox = mockSandbox(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "",
      durationMs: 60000,
      timedOut: true,
    }));
    const driver = createClaudeCodeDriver();
    const result = await driver.execute(sandbox, "do something");
    expect(result.status).toBe("failure");
    expect(result.error).toContain("timed out");
  });

  test("parses token usage from JSON output", async () => {
    const sandbox = mockSandbox();
    const driver = createClaudeCodeDriver();
    const result = await driver.execute(sandbox, "do something");
    expect(result.status).toBe("success");
    expect(result.tokenUsage.inputTokens).toBe(100);
    expect(result.tokenUsage.outputTokens).toBe(50);
    expect(result.sessionId).toBe("sess-1");
  });
});

describe("PiDriver", () => {
  test("builds correct argv", async () => {
    let capturedArgv: string[] = [];
    const sandbox = mockSandbox(async (opts) => {
      capturedArgv = opts.argv;
      return {
        exitCode: 0,
        stdout: "done",
        stderr: "",
        durationMs: 100,
        timedOut: false,
      };
    });
    const driver = createPiDriver();
    await driver.execute(sandbox, "do something");
    expect(capturedArgv).toContain("pi");
    expect(capturedArgv).toContain("--print");
    expect(capturedArgv).toContain("do something");
  });

  test("handles non-zero exit", async () => {
    const sandbox = mockSandbox(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "pi error",
      durationMs: 100,
      timedOut: false,
    }));
    const driver = createPiDriver();
    const result = await driver.execute(sandbox, "do something");
    expect(result.status).toBe("failure");
    expect(result.error).toContain("pi error");
  });
});

describe("BASE_ALLOWED_TOOLS", () => {
  test("contains base set", () => {
    expect(BASE_ALLOWED_TOOLS).toContain("Read");
    expect(BASE_ALLOWED_TOOLS).toContain("Edit");
    expect(BASE_ALLOWED_TOOLS).toContain("Write");
    expect(BASE_ALLOWED_TOOLS).toContain("Glob");
    expect(BASE_ALLOWED_TOOLS).toContain("Grep");
    expect(BASE_ALLOWED_TOOLS).toContain("Bash(pnpm *)");
    expect(BASE_ALLOWED_TOOLS).toContain("Bash(git diff *)");
    expect(BASE_ALLOWED_TOOLS).toContain("Bash(git status *)");
  });

  test("has exactly 8 base tools", () => {
    expect(BASE_ALLOWED_TOOLS).toHaveLength(8);
  });
});

describe("ConsoleReporter", () => {
  const origWrite = process.stderr.write;
  let output: string[];

  function captureStderr(): void {
    output = [];
    process.stderr.write = ((chunk: string) => {
      output.push(chunk);
      return true;
    }) as typeof process.stderr.write;
  }

  afterEach(() => {
    process.stderr.write = origWrite;
  });

  test("redacts secrets by name pattern", () => {
    captureStderr();
    const reporter = createConsoleReporter({
      MY_TOKEN: "supersecretvalue123",
    });
    reporter.nodeOutput("test", "found supersecretvalue123 in output");
    expect(output.some((o) => o.includes("[REDACTED:MY_TOKEN]"))).toBe(true);
    expect(output.every((o) => !o.includes("supersecretvalue123"))).toBe(true);
  });

  test("redacts secrets by value", () => {
    captureStderr();
    const reporter = createConsoleReporter({
      SOME_SETTING: "notsecretbutlong",
    });
    reporter.nodeOutput("test", "val=notsecretbutlong end");
    expect(output.some((o) => o.includes("[REDACTED]"))).toBe(true);
    expect(output.every((o) => !o.includes("notsecretbutlong"))).toBe(true);
  });

  test("formats node lifecycle", () => {
    captureStderr();
    const reporter = createConsoleReporter({});
    reporter.nodeStart("my-step", "deterministic");
    reporter.nodeComplete("my-step", {
      status: "success",
      output: "ok",
      durationMs: 42,
    });
    expect(output.some((o) => o.includes("[deterministic]"))).toBe(true);
    expect(output.some((o) => o.includes("[+] my-step"))).toBe(true);
    expect(output.some((o) => o.includes("42ms"))).toBe(true);
  });

  test("formats run summary", () => {
    captureStderr();
    const reporter = createConsoleReporter({});
    reporter.runComplete({
      runId: "abcd1234",
      blueprint: "test-bp",
      repo: "./test",
      intent: "test",
      nodes: [
        { name: "step1", status: "success", output: "ok", durationMs: 10 },
      ],
      totalDurationMs: 100,
      tokenUsage: {
        inputTokens: 50,
        outputTokens: 25,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      push: false,
    });
    expect(output.some((o) => o.includes("abcd1234"))).toBe(true);
    expect(output.some((o) => o.includes("test-bp"))).toBe(true);
    expect(output.some((o) => o.includes("50in / 25out"))).toBe(true);
  });
});
