import { describe, test, expect } from "vitest";
import { createDaytonaSandbox } from "../src/sandbox/daytona.js";

const SKIP = !process.env["DAYTONA_API_KEY"];

describe.skipIf(SKIP)("Daytona sandbox integration", () => {
  test("full lifecycle: create, exec, upload, snapshot, teardown", async () => {
    const sandbox = await createDaytonaSandbox({
      repo: "daytonaio/sdk",
      branch: "test-harness",
      daytona: { snapshot: "daytona-small" },
    });

    try {
      // exec
      const result = await sandbox.exec({
        argv: ["echo", "hello"],
        cwd: sandbox.workDir,
        timeout: 10_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");

      // upload
      await sandbox.uploadFiles([
        { path: "test.txt", content: "integration test" },
      ]);

      // snapshot
      const snapId = await sandbox.snapshot();
      expect(snapId.length).toBeGreaterThan(0);
    } finally {
      await sandbox.teardown();
    }
  }, 120_000);
});
