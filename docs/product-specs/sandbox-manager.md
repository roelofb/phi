# Product Spec: Sandbox Manager

## Purpose

Provides isolated execution environments for agent runs. The `Sandbox` interface abstracts over two implementations: `LocalSandbox` (git worktree in a temp directory) for development, and `DaytonaSandbox` (stub) for production. All command execution, file operations, and cleanup are managed through this interface.

## Interface

```typescript
// src/sandbox/types.ts

import type { ExecOptions, ExecResult } from "../../contracts/types.js";

export interface Sandbox {
  /** Absolute path to the sandbox working directory */
  readonly workDir: string;

  /** Execute a command inside the sandbox */
  exec(opts: ExecOptions): Promise<ExecResult>;

  /** Copy files into the sandbox */
  uploadFiles(files: Array<{ path: string; content: string }>): Promise<void>;

  /** Create a snapshot of the current sandbox state (returns snapshot ID) */
  snapshot(): Promise<string>;

  /** Destroy the sandbox and clean up all resources */
  teardown(): Promise<void>;
}

export interface SandboxOptions {
  /** Source repository path or URL */
  repo: string;
  /** Branch to create for this run */
  branch: string;
  /** Per-operation timeout in ms (default 600_000 = 10min) */
  operationTimeout?: number;
}

/** Default per-operation timeout: 10 minutes */
export const DEFAULT_OPERATION_TIMEOUT = 600_000;

/** Default per-run timeout: 60 minutes */
export const DEFAULT_RUN_TIMEOUT = 3_600_000;

// src/sandbox/local.ts

export function createLocalSandbox(opts: SandboxOptions): Promise<Sandbox>;

// src/sandbox/daytona.ts (stub)

export function createDaytonaSandbox(opts: SandboxOptions): Promise<Sandbox>;
```

## Dependencies

- Foundation Types (`contracts/types.ts`) — `ExecOptions`, `ExecResult`
- Node.js built-ins: `child_process`, `fs/promises`, `path`, `os`
- No external npm packages

## Behaviour

### Create local sandbox

**Given**: a valid local git repo path and a branch name
**When**: `createLocalSandbox()` is called
**Then**: creates a git worktree in a temp directory (`os.tmpdir()/harness-<runId>`), checks out the specified branch, and returns a `Sandbox` whose `workDir` is the worktree root

### Exec in sandbox — success

**Given**: a created sandbox
**When**: `exec()` is called with valid argv
**Then**: runs the command with `cwd` confined to the sandbox `workDir`, returns `ExecResult` with `exitCode`, `stdout`, `stderr`, `durationMs`

### Exec in sandbox — path confinement

**Given**: a created sandbox
**When**: `exec()` is called with a `cwd` outside the sandbox `workDir`
**Then**: throws an error (path confinement violation)

### Exec in sandbox — timeout

**Given**: a created sandbox
**When**: `exec()` is called and the command exceeds its timeout
**Then**: the process is killed, returns `ExecResult` with `timedOut: true`

### Upload files

**Given**: a created sandbox
**When**: `uploadFiles()` is called with file descriptors
**Then**: writes each file relative to `workDir`, creating directories as needed

### Upload files — path traversal

**Given**: a created sandbox
**When**: `uploadFiles()` is called with a path containing `../`
**Then**: throws an error (path confinement violation)

### Snapshot

**Given**: a created sandbox with modifications
**When**: `snapshot()` is called
**Then**: creates a git stash or commit and returns a reference string

### Teardown

**Given**: a created sandbox
**When**: `teardown()` is called
**Then**: removes the git worktree and its temp directory, even if the worktree has uncommitted changes

### Teardown on crash

**Given**: a sandbox exists and an unhandled error occurs
**When**: the caller's try/finally block invokes `teardown()`
**Then**: cleanup succeeds (idempotent — calling teardown twice does not throw)

### Daytona stub

**Given**: any arguments
**When**: `createDaytonaSandbox()` is called
**Then**: throws an error with message "Daytona sandbox not yet implemented"

## Security Constraints

- **Path confinement**: All `exec()` cwd and `uploadFiles()` paths must resolve to within the sandbox `workDir`. Use `path.resolve()` and verify the resolved path starts with `workDir`.
- **argv only**: `exec()` uses `child_process.execFile` (not `exec` or `shell: true`) — no shell interpolation.
- **Cleanup guarantee**: `teardown()` must be called in a finally block. Teardown must not throw even if the worktree is already removed.
- **Timeout enforcement**: Operations that exceed timeout must be killed via signal.

## Acceptance Criteria

1. AC-1: `createLocalSandbox()` creates a git worktree from a valid repo
2. AC-2: `sandbox.workDir` is an absolute path inside the system temp directory
3. AC-3: `sandbox.exec()` runs commands with cwd inside the worktree
4. AC-4: `sandbox.exec()` rejects if cwd is outside workDir
5. AC-5: `sandbox.exec()` kills process and returns `timedOut: true` on timeout
6. AC-6: `sandbox.uploadFiles()` writes files relative to workDir
7. AC-7: `sandbox.uploadFiles()` rejects path traversal attempts (`../`)
8. AC-8: `sandbox.snapshot()` returns a non-empty string reference
9. AC-9: `sandbox.teardown()` removes the worktree directory
10. AC-10: `sandbox.teardown()` is idempotent (second call does not throw)
11. AC-11: `createDaytonaSandbox()` throws "not yet implemented"
12. AC-12: `exec()` uses `execFile`, not shell execution

## Test Scenarios

```typescript
// tests/sandbox-local.test.ts

import { createLocalSandbox } from "../src/sandbox/local.js";
import { createDaytonaSandbox } from "../src/sandbox/daytona.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

let testRepo: string;

beforeEach(async () => {
  // Create a temporary git repo for testing
  testRepo = await mkdtemp(join(tmpdir(), "harness-test-"));
  execFileSync("git", ["init"], { cwd: testRepo });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: testRepo });
});

afterEach(async () => {
  await rm(testRepo, { recursive: true, force: true });
});

test("creates sandbox with workDir in temp directory", async () => {
  const sandbox = await createLocalSandbox({ repo: testRepo, branch: "test-branch" });
  try {
    expect(sandbox.workDir).toContain(tmpdir());
  } finally {
    await sandbox.teardown();
  }
});

test("exec runs command in sandbox", async () => {
  const sandbox = await createLocalSandbox({ repo: testRepo, branch: "test-branch" });
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
  const sandbox = await createLocalSandbox({ repo: testRepo, branch: "test-branch" });
  try {
    await expect(
      sandbox.exec({ argv: ["ls"], cwd: "/tmp", timeout: 5000 })
    ).rejects.toThrow(/path confinement/i);
  } finally {
    await sandbox.teardown();
  }
});

test("exec handles timeout", async () => {
  const sandbox = await createLocalSandbox({ repo: testRepo, branch: "test-branch" });
  try {
    const result = await sandbox.exec({
      argv: ["sleep", "10"],
      cwd: sandbox.workDir,
      timeout: 100,
    });
    expect(result.timedOut).toBe(true);
  } finally {
    await sandbox.teardown();
  }
});

test("uploadFiles writes files", async () => {
  const sandbox = await createLocalSandbox({ repo: testRepo, branch: "test-branch" });
  try {
    await sandbox.uploadFiles([{ path: "test.txt", content: "hello" }]);
    const result = await sandbox.exec({
      argv: ["cat", "test.txt"],
      cwd: sandbox.workDir,
      timeout: 5000,
    });
    expect(result.stdout).toBe("hello");
  } finally {
    await sandbox.teardown();
  }
});

test("uploadFiles rejects path traversal", async () => {
  const sandbox = await createLocalSandbox({ repo: testRepo, branch: "test-branch" });
  try {
    await expect(
      sandbox.uploadFiles([{ path: "../escape.txt", content: "bad" }])
    ).rejects.toThrow(/path confinement/i);
  } finally {
    await sandbox.teardown();
  }
});

test("teardown is idempotent", async () => {
  const sandbox = await createLocalSandbox({ repo: testRepo, branch: "test-branch" });
  await sandbox.teardown();
  await expect(sandbox.teardown()).resolves.not.toThrow();
});

test("daytona stub throws", async () => {
  await expect(
    createDaytonaSandbox({ repo: "test", branch: "test" })
  ).rejects.toThrow(/not yet implemented/i);
});
```

## Files to Generate

- `src/sandbox/types.ts` — `Sandbox` interface, `SandboxOptions`, constants
- `src/sandbox/local.ts` — `createLocalSandbox()` implementation
- `src/sandbox/daytona.ts` — `createDaytonaSandbox()` stub
- `tests/sandbox-local.test.ts` — All test scenarios above
