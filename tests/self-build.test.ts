import { describe, test, expect } from "vitest";
import type { RunContext } from "../contracts/types.js";
import type { Sandbox } from "../src/sandbox/types.js";
import type { ExecOptions, ExecResult } from "../contracts/types.js";
import { TRUNCATION_MARKER } from "../src/util/sanitize.js";

function mockSandbox(execFn?: (opts: ExecOptions) => Promise<ExecResult>): Sandbox {
  return {
    workDir: "/tmp/test",
    exec:
      execFn ??
      (async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
        timedOut: false,
      })),
    uploadFiles: async () => {},
    snapshot: async () => "snap",
    teardown: async () => {},
  };
}

function baseCtx(overrides?: Partial<RunContext>): RunContext {
  return {
    runId: "test1234",
    workDir: "/tmp/test",
    intent: "test",
    repo: ".",
    push: false,
    env: {},
    results: {},
    sandboxType: "local",
    ...overrides,
  };
}

describe("self-build preflight", () => {
  test("fails when specPath is undefined", async () => {
    const { selfBuild } = await import("../blueprints/self-build.js");
    const preflightNode = selfBuild.nodes[0]!;
    if (preflightNode.type !== "preflight") throw new Error("Expected preflight node");

    const result = await preflightNode.check(
      baseCtx({ specPath: undefined }),
      mockSandbox(),
    );
    expect(result.status).toBe("failure");
    expect(result.error).toContain("specPath is required");
  });

  test("fails when sandboxType is not local", async () => {
    const { selfBuild } = await import("../blueprints/self-build.js");
    const preflightNode = selfBuild.nodes[0]!;
    if (preflightNode.type !== "preflight") throw new Error("Expected preflight node");

    const result = await preflightNode.check(
      baseCtx({ sandboxType: "daytona", specPath: "docs/spec.md" }),
      mockSandbox(),
    );
    expect(result.status).toBe("failure");
    expect(result.error).toContain("local");
  });

  test("fails when spec file does not exist", async () => {
    const { selfBuild } = await import("../blueprints/self-build.js");
    const preflightNode = selfBuild.nodes[0]!;
    if (preflightNode.type !== "preflight") throw new Error("Expected preflight node");

    const sandbox = mockSandbox(async (opts) => {
      if (opts.argv[0] === "test") {
        return { exitCode: 1, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      }
      return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 1, timedOut: false };
    });

    const result = await preflightNode.check(
      baseCtx({ specPath: "nonexistent.md" }),
      sandbox,
    );
    expect(result.status).toBe("failure");
    expect(result.error).toContain("not found");
  });

  test("passes with valid specPath and tools", async () => {
    const { selfBuild } = await import("../blueprints/self-build.js");
    const preflightNode = selfBuild.nodes[0]!;
    if (preflightNode.type !== "preflight") throw new Error("Expected preflight node");

    const sandbox = mockSandbox(async (opts) => {
      if (opts.argv[0] === "test") {
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      }
      if (opts.argv[0] === "git") {
        return { exitCode: 0, stdout: "git version 2.40", stderr: "", durationMs: 1, timedOut: false };
      }
      if (opts.argv[0] === "pnpm") {
        return { exitCode: 0, stdout: "10.30.1", stderr: "", durationMs: 1, timedOut: false };
      }
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    });

    const result = await preflightNode.check(
      baseCtx({ specPath: "docs/product-specs/json-reporter.md" }),
      sandbox,
    );
    expect(result.status).toBe("success");
    expect(result.output).toContain("json-reporter.md");
  });
});

describe("self-build export-patch", () => {
  test("patch path stays confined within repo dir", async () => {
    const { selfBuild } = await import("../blueprints/self-build.js");
    const exportNode = selfBuild.nodes.find((n) => n.name === "export-patch");
    if (!exportNode || exportNode.type !== "deterministic") {
      throw new Error("Expected deterministic export-patch node");
    }

    const sandbox = mockSandbox(async () => ({
      exitCode: 0,
      stdout: "diff --git a/file\n+added",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    }));

    // runId with enough traversal to escape repo dir
    await expect(
      exportNode.exec(
        baseCtx({ specPath: "spec.md", runId: "x/../../../../tmp/evil" }),
        sandbox,
      ),
    ).rejects.toThrow("Path confinement violation");
  });

  test("truncation guard fails on truncated diff", async () => {
    const { selfBuild } = await import("../blueprints/self-build.js");
    const exportNode = selfBuild.nodes.find((n) => n.name === "export-patch");
    if (!exportNode || exportNode.type !== "deterministic") {
      throw new Error("Expected deterministic export-patch node");
    }

    const sandbox = mockSandbox(async () => ({
      exitCode: 0,
      stdout: `diff --git a/file\n+added line\n${TRUNCATION_MARKER}`,
      stderr: "",
      durationMs: 1,
      timedOut: false,
    }));

    const result = await exportNode.exec(
      baseCtx({ specPath: "spec.md" }),
      sandbox,
    );
    expect(result.status).toBe("failure");
    expect(result.error).toContain("truncated");
  });
});
