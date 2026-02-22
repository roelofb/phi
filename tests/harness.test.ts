import { describe, test, expect } from "vitest";
import { runHarness } from "../src/harness.js";
import { blueprint, deterministic } from "../src/blueprint/dsl.js";
import type { Reporter } from "../src/reporter/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function mockReporter(): Reporter {
  return {
    nodeStart: () => {},
    nodeOutput: () => {},
    nodeComplete: () => {},
    runComplete: () => {},
  };
}

let testRepo: string;

async function createTestRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "harness-int-"));
  execFileSync("git", ["init"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@test.com"], {
    cwd: repo,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
    cwd: repo,
  });
  return repo;
}

describe("runHarness", () => {
  test("returns RunReport on success", async () => {
    testRepo = await createTestRepo();
    try {
      const bp = blueprint("test", "test blueprint", [
        deterministic("step1", "do thing", async () => ({
          status: "success",
          output: "done",
          durationMs: 1,
        })),
      ]);
      const report = await runHarness({
        blueprint: bp,
        repo: testRepo,
        intent: "test intent",
        push: false,
        sandboxType: "local",
        reporter: mockReporter(),
      });
      expect(report.runId).toMatch(/^[0-9a-f]{8}$/);
      expect(report.nodes).toHaveLength(1);
      expect(report.nodes[0]!.status).toBe("success");
      expect(report.blueprint).toBe("test");
    } finally {
      await rm(testRepo, { recursive: true, force: true });
    }
  });

  test("tears down sandbox on failure", async () => {
    testRepo = await createTestRepo();
    try {
      const bp = blueprint("test", "test", [
        deterministic("fail", "fails", async () => ({
          status: "failure",
          output: "boom",
          durationMs: 1,
          error: "intentional",
        })),
      ]);
      const report = await runHarness({
        blueprint: bp,
        repo: testRepo,
        intent: "test",
        push: false,
        sandboxType: "local",
        reporter: mockReporter(),
      });
      expect(report.nodes[0]!.status).toBe("failure");
    } finally {
      await rm(testRepo, { recursive: true, force: true });
    }
  });

  test("branch naming follows convention", async () => {
    testRepo = await createTestRepo();
    try {
      const bp = blueprint("my-blueprint", "test", [
        deterministic("step", "step", async () => ({
          status: "success",
          output: "ok",
          durationMs: 1,
        })),
      ]);
      const report = await runHarness({
        blueprint: bp,
        repo: testRepo,
        intent: "test",
        push: false,
        sandboxType: "local",
        runId: "deadbeef",
        reporter: mockReporter(),
      });
      expect(report.branch).toBe("harness/deadbeef/my-blueprint");
    } finally {
      await rm(testRepo, { recursive: true, force: true });
    }
  });

  test("reporter callbacks fire", async () => {
    testRepo = await createTestRepo();
    const events: string[] = [];
    const reporter: Reporter = {
      nodeStart: (name) => events.push(`start:${name}`),
      nodeOutput: () => {},
      nodeComplete: (name) => events.push(`complete:${name}`),
      runComplete: () => events.push("done"),
    };
    try {
      const bp = blueprint("test", "test", [
        deterministic("s1", "step", async () => ({
          status: "success",
          output: "ok",
          durationMs: 1,
        })),
      ]);
      await runHarness({
        blueprint: bp,
        repo: testRepo,
        intent: "test",
        push: false,
        sandboxType: "local",
        reporter,
      });
      expect(events).toContain("complete:s1");
      expect(events).toContain("done");
    } finally {
      await rm(testRepo, { recursive: true, force: true });
    }
  });
});

describe("blueprints", () => {
  test("bug-fix blueprint has correct structure", async () => {
    const { bugFix } = await import("../blueprints/bug-fix.js");
    expect(bugFix.name).toBe("bug-fix");
    expect(bugFix.nodes.length).toBeGreaterThanOrEqual(5);
    expect(bugFix.nodes[0]!.type).toBe("preflight");
    expect(bugFix.nodes.some((n) => n.type === "validate")).toBe(true);
    expect(bugFix.nodes.at(-1)!.type).toBe("deterministic");
  });

  test("self-build blueprint has correct structure", async () => {
    const { selfBuild } = await import("../blueprints/self-build.js");
    expect(selfBuild.name).toBe("self-build");
    expect(selfBuild.nodes.length).toBeGreaterThanOrEqual(5);
    expect(selfBuild.nodes[0]!.type).toBe("preflight");
    expect(selfBuild.nodes.some((n) => n.type === "agentic")).toBe(true);
    expect(selfBuild.nodes.some((n) => n.type === "validate")).toBe(true);
  });
});
