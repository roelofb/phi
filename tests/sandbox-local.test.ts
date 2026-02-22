import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createLocalSandbox } from "../src/sandbox/local.js";
import { createDaytonaSandbox } from "../src/sandbox/daytona.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

let testRepo: string;

beforeEach(async () => {
  testRepo = await mkdtemp(join(tmpdir(), "harness-test-"));
  execFileSync("git", ["init"], { cwd: testRepo });
  execFileSync("git", ["config", "user.email", "test@test.com"], {
    cwd: testRepo,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: testRepo });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: testRepo });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
    cwd: testRepo,
  });
});

afterEach(async () => {
  await rm(testRepo, { recursive: true, force: true });
});

describe("createLocalSandbox", () => {
  test("creates sandbox with workDir in temp directory", async () => {
    const sandbox = await createLocalSandbox({
      repo: testRepo,
      branch: "test-branch",
    });
    try {
      expect(sandbox.workDir).toContain(tmpdir());
    } finally {
      await sandbox.teardown();
    }
  });

  test("exec runs command in sandbox", async () => {
    const sandbox = await createLocalSandbox({
      repo: testRepo,
      branch: "test-exec",
    });
    try {
      const result = await sandbox.exec({
        argv: ["echo", "hello"],
        cwd: sandbox.workDir,
        timeout: 5000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
    } finally {
      await sandbox.teardown();
    }
  });

  test("exec rejects cwd outside sandbox", async () => {
    const sandbox = await createLocalSandbox({
      repo: testRepo,
      branch: "test-confine",
    });
    try {
      await expect(
        sandbox.exec({ argv: ["ls"], cwd: "/tmp", timeout: 5000 }),
      ).rejects.toThrow(/path confinement/i);
    } finally {
      await sandbox.teardown();
    }
  });

  test("exec handles timeout", async () => {
    const sandbox = await createLocalSandbox({
      repo: testRepo,
      branch: "test-timeout",
    });
    try {
      const result = await sandbox.exec({
        argv: ["sleep", "10"],
        cwd: sandbox.workDir,
        timeout: 200,
      });
      expect(result.timedOut).toBe(true);
    } finally {
      await sandbox.teardown();
    }
  });

  test("exec returns non-zero exit code", async () => {
    const sandbox = await createLocalSandbox({
      repo: testRepo,
      branch: "test-nonzero",
    });
    try {
      const result = await sandbox.exec({
        argv: ["ls", "/nonexistent-dir-xyz"],
        cwd: sandbox.workDir,
        timeout: 5000,
      });
      expect(result.exitCode).not.toBe(0);
    } finally {
      await sandbox.teardown();
    }
  });

  test("uploadFiles writes files", async () => {
    const sandbox = await createLocalSandbox({
      repo: testRepo,
      branch: "test-upload",
    });
    try {
      await sandbox.uploadFiles([{ path: "test.txt", content: "hello" }]);
      const content = await readFile(join(sandbox.workDir, "test.txt"), "utf-8");
      expect(content).toBe("hello");
    } finally {
      await sandbox.teardown();
    }
  });

  test("uploadFiles creates nested directories", async () => {
    const sandbox = await createLocalSandbox({
      repo: testRepo,
      branch: "test-nested",
    });
    try {
      await sandbox.uploadFiles([
        { path: "a/b/c.txt", content: "deep" },
      ]);
      const content = await readFile(
        join(sandbox.workDir, "a/b/c.txt"),
        "utf-8",
      );
      expect(content).toBe("deep");
    } finally {
      await sandbox.teardown();
    }
  });

  test("uploadFiles rejects path traversal", async () => {
    const sandbox = await createLocalSandbox({
      repo: testRepo,
      branch: "test-traversal",
    });
    try {
      await expect(
        sandbox.uploadFiles([{ path: "../escape.txt", content: "bad" }]),
      ).rejects.toThrow(/path confinement/i);
    } finally {
      await sandbox.teardown();
    }
  });

  test("snapshot returns non-empty string", async () => {
    const sandbox = await createLocalSandbox({
      repo: testRepo,
      branch: "test-snapshot",
    });
    try {
      const snapId = await sandbox.snapshot();
      expect(snapId).toMatch(/^[0-9a-f]{8}$/);
    } finally {
      await sandbox.teardown();
    }
  });

  test("teardown is idempotent", async () => {
    const sandbox = await createLocalSandbox({
      repo: testRepo,
      branch: "test-idempotent",
    });
    await sandbox.teardown();
    await expect(sandbox.teardown()).resolves.not.toThrow();
  });
});

describe("assertPathConfined", () => {
  test("rejects sibling-prefix bypass", async () => {
    const { assertPathConfined } = await import("../src/util/path.js");
    // /tmp/root2 should NOT be considered confined to /tmp/root
    expect(() => assertPathConfined("/tmp/root2/file", "/tmp/root")).toThrow(
      /path confinement/i,
    );
  });

  test("allows path within root", async () => {
    const { assertPathConfined } = await import("../src/util/path.js");
    expect(() => assertPathConfined("/tmp/root/sub/file", "/tmp/root")).not.toThrow();
  });

  test("allows root itself", async () => {
    const { assertPathConfined } = await import("../src/util/path.js");
    expect(() => assertPathConfined("/tmp/root", "/tmp/root")).not.toThrow();
  });

  test("rejects parent traversal", async () => {
    const { assertPathConfined } = await import("../src/util/path.js");
    expect(() => assertPathConfined("/tmp/root/../other", "/tmp/root")).toThrow(
      /path confinement/i,
    );
  });
});

describe("createDaytonaSandbox", () => {
  test("throws not yet implemented", async () => {
    await expect(
      createDaytonaSandbox({ repo: "test", branch: "test" }),
    ).rejects.toThrow(/not yet implemented/i);
  });
});
