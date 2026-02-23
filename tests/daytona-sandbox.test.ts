import { describe, test, expect, vi, beforeEach } from "vitest";
import type { ExecOptions } from "../contracts/types.js";

// Hoist mocks so vi.mock factory can reference them
const { mockGit, mockDaytonaSandbox, mockCreate, mockDelete } = vi.hoisted(() => {
  const mockGit = {
    clone: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ sha: "abc123" }),
    push: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ fileStatus: [{ name: "file.ts" }] }),
  };

  const mockProcess = {
    createSession: vi.fn().mockResolvedValue(undefined),
    executeSessionCommand: vi.fn().mockResolvedValue({
      cmdId: "cmd-1",
      exitCode: 0,
      stdout: "hello\n",
      stderr: "",
    }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  };

  const mockFs = {
    uploadFile: vi.fn().mockResolvedValue(undefined),
    createFolder: vi.fn().mockResolvedValue(undefined),
  };

  const mockDaytonaSandbox = {
    process: mockProcess,
    fs: mockFs,
    git: mockGit,
  };

  const mockCreate = vi.fn().mockResolvedValue(mockDaytonaSandbox);
  const mockDelete = vi.fn().mockResolvedValue(undefined);

  return { mockGit, mockDaytonaSandbox, mockCreate, mockDelete };
});

vi.mock("@daytonaio/sdk", () => ({
  Daytona: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.create = mockCreate;
    this.delete = mockDelete;
  }),
}));

// Import after mock
const { createDaytonaSandbox } = await import("../src/sandbox/daytona.js");

function baseOpts() {
  return {
    repo: "acme/widgets",
    branch: "harness/abc/test",
    daytona: { apiKey: "test-key" },
  };
}

describe("createDaytonaSandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(mockDaytonaSandbox);
    mockGit.clone.mockResolvedValue(undefined);
    mockGit.status.mockResolvedValue({ fileStatus: [{ name: "file.ts" }] });
    mockDelete.mockResolvedValue(undefined);
    // Re-stub persistent session creation (called during bootstrap)
    mockDaytonaSandbox.process.createSession.mockResolvedValue(undefined);
  });

  test("AC-1: creates sandbox via SDK", async () => {
    const sandbox = await createDaytonaSandbox(baseOpts());
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(sandbox.workDir).toBeDefined();
  });

  test("AC-2: workDir derived from repo name", async () => {
    const sandbox = await createDaytonaSandbox(baseOpts());
    expect(sandbox.workDir).toBe("/home/daytona/workspace/widgets");
  });

  test("AC-4: exec rejects cwd outside workDir", async () => {
    const sandbox = await createDaytonaSandbox(baseOpts());
    await expect(
      sandbox.exec({ argv: ["ls"], cwd: "/etc", timeout: 5000 }),
    ).rejects.toThrow(/path confinement/i);
  });

  test("AC-11: throws on missing API key", async () => {
    const saved = process.env["DAYTONA_API_KEY"];
    delete process.env["DAYTONA_API_KEY"];
    try {
      await expect(
        createDaytonaSandbox({ repo: "acme/widgets", branch: "test" }),
      ).rejects.toThrow(/api key required/i);
    } finally {
      if (saved) process.env["DAYTONA_API_KEY"] = saved;
    }
  });

  test("AC-19: rejects local paths", async () => {
    await expect(
      createDaytonaSandbox({ ...baseOpts(), repo: "." }),
    ).rejects.toThrow(/not a github repo/i);

    await expect(
      createDaytonaSandbox({ ...baseOpts(), repo: "/Users/x/repo" }),
    ).rejects.toThrow(/not a github repo/i);

    await expect(
      createDaytonaSandbox({ ...baseOpts(), repo: "./my-project" }),
    ).rejects.toThrow(/not a github repo/i);
  });

  test("AC-20: bootstrap failure deletes sandbox", async () => {
    mockGit.clone.mockRejectedValueOnce(new Error("clone failed"));
    await expect(
      createDaytonaSandbox(baseOpts()),
    ).rejects.toThrow(/clone failed/);
    expect(mockDelete).toHaveBeenCalledWith(mockDaytonaSandbox);
  });

  test("AC-10: teardown is idempotent", async () => {
    const sandbox = await createDaytonaSandbox(baseOpts());
    await sandbox.teardown();
    await sandbox.teardown(); // second call should not throw
    // delete called only once (first teardown)
    expect(mockDelete).toHaveBeenCalledOnce();
  });

  test("AC-8: snapshot uses git.commit", async () => {
    const sandbox = await createDaytonaSandbox(baseOpts());
    const snapId = await sandbox.snapshot();
    expect(snapId).toMatch(/^[0-9a-f]{8}$/);
    expect(mockGit.add).toHaveBeenCalledWith(sandbox.workDir, ["."]);
    expect(mockGit.commit).toHaveBeenCalledWith(
      sandbox.workDir,
      expect.stringMatching(/^snapshot-[0-9a-f]{8}$/),
      "harness",
      "harness@local",
    );
  });

  test("AC-24: env key validation rejects bad keys", async () => {
    const sandbox = await createDaytonaSandbox(baseOpts());
    const badKeys = ["bad key", "bad=key", "$(inject)", "", "123start"];

    for (const key of badKeys) {
      await expect(
        sandbox.exec({
          argv: ["echo", "hi"],
          cwd: sandbox.workDir,
          timeout: 5000,
          env: { [key]: "value" },
        } as ExecOptions),
      ).rejects.toThrow(/invalid env key/i);
    }
  });
});
