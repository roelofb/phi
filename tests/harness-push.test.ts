import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Sandbox } from "../src/sandbox/types.js";
import type { Blueprint } from "../src/blueprint/types.js";
import type { Reporter } from "../src/reporter/types.js";
import { runHarness } from "../src/harness.js";

// Minimal no-op blueprint
const emptyBlueprint: Blueprint = {
  name: "test-bp",
  description: "test",
  nodes: [],
};

// Stub reporter
function stubReporter(): Reporter {
  return {
    nodeStart: vi.fn(),
    nodeOutput: vi.fn(),
    nodeComplete: vi.fn(),
    runComplete: vi.fn(),
  };
}

// Build a mock sandbox factory
function mockSandbox(overrides?: Partial<Sandbox>): Sandbox {
  return {
    workDir: "/tmp/test",
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 10, timedOut: false }),
    uploadFiles: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue("abc12345"),
    teardown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// Mock sandbox factories to return our mock
const sandbox = mockSandbox({
  pushBranch: vi.fn().mockResolvedValue({ pushed: true }),
  defaultBranch: vi.fn().mockResolvedValue("main"),
});

vi.mock("../src/sandbox/local.js", () => ({
  createLocalSandbox: vi.fn().mockImplementation(() => Promise.resolve(sandbox)),
}));

vi.mock("../src/sandbox/daytona.js", () => ({
  createDaytonaSandbox: vi.fn().mockImplementation(() => Promise.resolve(sandbox)),
}));

// Mock fetch for PR creation
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ html_url: "https://github.com/acme/widgets/pull/1" }),
  text: () => Promise.resolve(""),
});
vi.stubGlobal("fetch", mockFetch);

describe("push+PR flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (sandbox.pushBranch as ReturnType<typeof vi.fn>).mockResolvedValue({ pushed: true });
    (sandbox.defaultBranch as ReturnType<typeof vi.fn>).mockResolvedValue("main");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ html_url: "https://github.com/acme/widgets/pull/1" }),
      text: () => Promise.resolve(""),
    });
  });

  test("AC-15: push triggers git push + PR creation", async () => {
    const report = await runHarness({
      blueprint: emptyBlueprint,
      repo: "acme/widgets",
      intent: "test push",
      push: true,
      sandboxType: "daytona",
      reporter: stubReporter(),
      githubToken: "ghp_test",
      agentExecutor: { execute: vi.fn() },
    });

    expect(sandbox.pushBranch).toHaveBeenCalled();
    expect(report.pushResult?.pushed).toBe(true);
    expect(report.pushResult?.prUrl).toBe("https://github.com/acme/widgets/pull/1");
  });

  test("AC-16: push failure does not fail run", async () => {
    (sandbox.pushBranch as ReturnType<typeof vi.fn>).mockResolvedValue({
      pushed: false,
      error: "auth denied",
    });

    const report = await runHarness({
      blueprint: emptyBlueprint,
      repo: "acme/widgets",
      intent: "test push fail",
      push: true,
      sandboxType: "daytona",
      reporter: stubReporter(),
      githubToken: "ghp_test",
      agentExecutor: { execute: vi.fn() },
    });

    // Run completes without throwing
    expect(report.pushResult?.pushed).toBe(false);
    expect(report.pushResult?.error).toContain("auth denied");
  });

  test("AC-21: missing token returns error", async () => {
    const report = await runHarness({
      blueprint: emptyBlueprint,
      repo: "acme/widgets",
      intent: "test no token",
      push: true,
      sandboxType: "daytona",
      reporter: stubReporter(),
      // No githubToken
      agentExecutor: { execute: vi.fn() },
    });

    expect(report.pushResult?.pushed).toBe(false);
    expect(report.pushResult?.error).toContain("GITHUB_TOKEN");
  });

  test("AC-22: pushResult schema", async () => {
    const report = await runHarness({
      blueprint: emptyBlueprint,
      repo: "acme/widgets",
      intent: "test schema",
      push: true,
      sandboxType: "daytona",
      reporter: stubReporter(),
      githubToken: "ghp_test",
      agentExecutor: { execute: vi.fn() },
    });

    const pr = report.pushResult;
    expect(pr).toBeDefined();
    expect(typeof pr!.pushed).toBe("boolean");
    expect(typeof pr!.prUrl).toBe("string");
    expect(pr!.error).toBeUndefined();
  });

  test("no push flag means no pushResult", async () => {
    const report = await runHarness({
      blueprint: emptyBlueprint,
      repo: "acme/widgets",
      intent: "no push",
      push: false,
      sandboxType: "daytona",
      reporter: stubReporter(),
      githubToken: "ghp_test",
      agentExecutor: { execute: vi.fn() },
    });

    expect(report.pushResult).toBeUndefined();
  });
});
