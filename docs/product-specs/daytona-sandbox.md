# Product Spec: Daytona Sandbox

## Purpose

Replace the `createDaytonaSandbox` stub with a real implementation using the `@daytonaio/sdk`. Provides containerised, remote execution environments for agent runs in production. Same `Sandbox` interface as `LocalSandbox`, but backed by Daytona's cloud infrastructure — sub-100ms cold starts, true process isolation, unlimited persistence, snapshot-based reproducibility.

Phase 3 also wires the push+PR flow in the harness orchestrator so that `--push --sandbox daytona` produces a real GitHub PR.

## Interface

```typescript
// src/sandbox/types.ts — ADDITIONS to existing file

export interface DaytonaOptions {
  /** Daytona API key (default: DAYTONA_API_KEY env var) */
  apiKey?: string;
  /** Daytona API URL (default: https://app.daytona.io/api) */
  apiUrl?: string;
  /** Daytona target region (default: DAYTONA_TARGET env var or "us") */
  target?: string;
  /** Snapshot name (default: "daytona-medium") */
  snapshot?: string;
  /** Resource limits (applied when snapshot supports resizing) */
  resources?: { cpu?: number; memory?: number; disk?: number };
}

export interface SandboxOptions {
  repo: string;
  branch: string;
  operationTimeout?: number;
  /** Daytona-specific options (ignored by LocalSandbox) */
  daytona?: DaytonaOptions;
  /** GitHub PAT for clone/push (read from GITHUB_TOKEN env var if not set) */
  githubToken?: string;
}

// src/sandbox/daytona.ts

export function createDaytonaSandbox(opts: SandboxOptions): Promise<Sandbox>;

// src/util/shell.ts — NEW file

/** Convert argv array to a safely-quoted shell command string */
export function shellQuote(argv: string[]): string;

// src/util/github.ts — NEW file

/** Parse a GitHub repo reference into owner and name */
export function parseGitHubRepo(repo: string): { owner: string; name: string };
```

The returned `Sandbox` fulfils the existing interface identically to `LocalSandbox`:

```typescript
interface Sandbox {
  readonly workDir: string;
  exec(opts: ExecOptions): Promise<ExecResult>;
  uploadFiles(files: Array<{ path: string; content: string }>): Promise<void>;
  snapshot(): Promise<string>;
  teardown(): Promise<void>;

  /** Push the current branch to remote. Optional — returns undefined if not supported. */
  pushBranch?(branch: string, token: string): Promise<{ pushed: boolean; error?: string }>;

  /** Get the default branch name of the remote repo. Optional. */
  defaultBranch?(): Promise<string>;
}
```

`pushBranch` and `defaultBranch` are optional methods — `LocalSandbox` can implement them via `exec()`, `DaytonaSandbox` uses SDK methods. The harness checks for their existence and falls back to `exec()` when absent.

```typescript
// harness.ts push logic
if (sandbox.pushBranch) {
  const result = await sandbox.pushBranch(branch, token);
  // ...
} else {
  // Local fallback via exec
  await sandbox.exec({ argv: ["git", "push", "-u", "origin", branch], ... });
}
```

### HarnessOptions additions

```typescript
// src/harness.ts — additions to existing HarnessOptions interface

export interface HarnessOptions {
  // ... existing fields (blueprint, repo, intent, push, sandboxType, runId, reporter, specPath) ...

  /** GitHub PAT for clone/push. Read from GITHUB_TOKEN env var in CLI. */
  githubToken?: string;

  /** Daytona-specific configuration. Ignored when sandboxType === "local". */
  daytona?: DaytonaOptions;
}
```

`runHarness()` passes `opts.githubToken` and `opts.daytona` into `SandboxOptions` when creating the sandbox, and uses `opts.githubToken` in the push+PR flow.

CLI (`src/cli.ts`) reads env vars only — no CLI flags for tokens or Daytona config:
- `GITHUB_TOKEN` → `githubToken`
- `DAYTONA_API_KEY` → `daytona.apiKey`
- `DAYTONA_API_URL` → `daytona.apiUrl`
- `DAYTONA_TARGET` → `daytona.target`

### Push+PR additions to harness.ts

```typescript
// src/harness.ts — additions after blueprint execution, before teardown

interface PushResult {
  pushed: boolean;
  prUrl?: string;
  error?: string;
}

// If push is requested, push the branch and create a PR
if (opts.push) {
  const pushResult = await pushAndCreatePR(sandbox, ctx, branch, opts.githubToken);
  finalReport.pushResult = pushResult;
}

// For Daytona: use sandbox.git.push() + GitHub REST API (no gh dependency)
// For Local: use sandbox.exec(["git", "push"]) + sandbox.exec(["gh", "pr", "create"])
async function pushAndCreatePR(
  sandbox: Sandbox,
  ctx: RunContext,
  branch: string,
  githubToken?: string,
): Promise<PushResult>;
```

### RunReport additions

```typescript
// contracts/types.ts — addition to RunReport

export interface RunReport {
  // ... existing fields ...
  pushResult?: {
    pushed: boolean;
    prUrl?: string;
    error?: string;
  };
}
```

## Dependencies

- `@daytonaio/sdk` — Daytona TypeScript SDK (new npm dependency)
- Foundation Types (`contracts/types.ts`) — `ExecOptions`, `ExecResult`
- `src/util/path.ts` — `assertPathConfined`
- `src/util/sanitize.ts` — `truncate`, `MAX_OUTPUT_BYTES`
- `src/util/shell.ts` — `shellQuote` (new)
- `src/util/github.ts` — `parseGitHubRepo` (new)
- Node.js built-ins: `path`, `crypto`

## Behaviour

### Create Daytona sandbox — default snapshot

**Given**: a valid GitHub repo URL (e.g. `org/repo` or `https://github.com/org/repo`), a branch name, and a `DAYTONA_API_KEY` env var
**When**: `createDaytonaSandbox()` is called
**Then**: creates a Daytona sandbox from the `daytona-medium` snapshot, clones the repo's default branch via SDK `sandbox.git.clone()` (no branch arg — the harness branch doesn't exist remotely), creates and checks out the harness branch via `sandbox.git.createBranch()` + `sandbox.git.checkoutBranch()`, and returns a `Sandbox` whose `workDir` is the chosen clone path inside the container (constructed as `/home/daytona/workspace/{repoName}` via `parseGitHubRepo()`, not hardcoded or derived post-hoc)

### Create Daytona sandbox — custom snapshot

**Given**: `opts.daytona.snapshot` is `"harness-node22"`
**When**: `createDaytonaSandbox()` is called
**Then**: uses that snapshot instead of `daytona-medium`

### Create Daytona sandbox — missing API key

**Given**: no `DAYTONA_API_KEY` env var and no `opts.daytona.apiKey`
**When**: `createDaytonaSandbox()` is called
**Then**: throws with message "Daytona API key required (set DAYTONA_API_KEY or pass opts.daytona.apiKey)"

### Create Daytona sandbox — local path rejected

**Given**: `opts.repo` is a local filesystem path (e.g. `.`, `/Users/x/repo`, `./my-project`)
**When**: `createDaytonaSandbox()` is called
**Then**: throws with message "Daytona sandbox requires a GitHub repo URL (e.g. org/repo), not a local path"

Detection: if `opts.repo` does not contain `/` with an org prefix or starts with `.`, `/`, or `~`, it's local.

### Create Daytona sandbox — private repo with token

**Given**: a private GitHub repo and `opts.githubToken` is set (or `GITHUB_TOKEN` env var)
**When**: the sandbox clones the repo
**Then**: uses the token for authentication via SDK `sandbox.git.clone(url, path, undefined, undefined, "git", token)` (default branch clone, then create harness branch)

### Create Daytona sandbox — bootstrap failure cleanup

**Given**: sandbox is created via SDK but git clone fails (bad URL, auth error, etc.)
**When**: the clone step throws
**Then**: the factory calls `daytona.delete(sandbox)` before re-throwing — no orphaned sandbox

### Exec in Daytona sandbox — success with stderr separation

**Given**: a created Daytona sandbox
**When**: `exec()` is called with argv `["pnpm", "test"]` and cwd within workDir
**Then**: converts argv to a shell command via `shellQuote()`, runs it inside the container using a **session-based execution** (`sandbox.process.createSession` / `executeSessionCommand`), captures stdout and stderr separately, returns `ExecResult` with `exitCode`, `stdout`, `stderr`, `durationMs`

**Rationale**: Agent drivers (Claude Code, Pi, Codex) rely on separate stderr for error reporting. Daytona's `executeCommand()` merges stdout/stderr into a single `result` field. Session-based execution provides separate stdout/stderr streams.

**Debug fallback**: Session-based execution is the only production path. A simple `executeCommand()` fallback is available behind `DAYTONA_SIMPLE_EXEC=1` env var for debugging only — not auto-detected. Mapping:
- On success (`exitCode === 0`): `stdout = result`, `stderr = ""`
- On failure (`exitCode !== 0`): `stdout = result`, `stderr = result` (duplicate into both — callers that check stderr will find the error)

### Exec in Daytona sandbox — path confinement

**Given**: a created Daytona sandbox
**When**: `exec()` is called with cwd outside workDir (e.g. `/etc`)
**Then**: throws path confinement violation (validated locally before sending to Daytona)

### Exec in Daytona sandbox — timeout

**Given**: a created Daytona sandbox
**When**: `exec()` is called and the command exceeds its timeout
**Then**: returns `ExecResult` with `timedOut: true` (Daytona's timeout parameter is in seconds — convert from ms with `Math.ceil(timeout / 1000)`)

### Exec in Daytona sandbox — maxOutput

**Given**: a created Daytona sandbox and a command that produces large output
**When**: the output exceeds `maxOutput` bytes
**Then**: output is truncated via `truncate()` before returning (consistent with local sandbox)

### Exec in Daytona sandbox — env key validation

**Given**: a created Daytona sandbox
**When**: `exec()` is called with `env` containing a key that doesn't match `^[A-Za-z_][A-Za-z0-9_]*$` (e.g. keys with `=`, spaces, `$(...)`, backticks, newlines, or empty string)
**Then**: throws with message `Invalid env key "<key>" — must match [A-Za-z_][A-Za-z0-9_]*`

Validation happens in `exec()` before building the shell command string. This prevents injection via environment variable names.

### Upload files

**Given**: a created Daytona sandbox
**When**: `uploadFiles()` is called with file descriptors
**Then**: for each file:
1. Validate path via `assertPathConfined` (locally)
2. Create parent directories via `sandbox.fs.createFolder(dir, "755")` as needed
3. Upload file via `sandbox.fs.uploadFiles([{ source: Buffer.from(content), destination: resolvedPath }])`

### Upload files — path traversal

**Given**: a created Daytona sandbox
**When**: `uploadFiles()` is called with a path containing `../`
**Then**: throws path confinement violation (validated locally before any SDK call)

### Snapshot

**Given**: a created Daytona sandbox with modifications
**When**: `snapshot()` is called
**Then**:
1. Check for changes via `sandbox.git.status(workDir)` — if `fileStatus` is empty, use `executeCommand("git commit --allow-empty -m 'snapshot-<id>'")` (SDK `git.commit()` may not support `--allow-empty`)
2. If changes exist: `sandbox.git.add(workDir, ["."])` then `sandbox.git.commit(workDir, "snapshot-<id>", "harness", "harness@local")`
3. Returns the snapshot ID string

**Note**: SDK `git.commit(path, message, author, email)` has 4 parameters — no `allowEmpty` flag. For empty-tree snapshots, fall back to `executeCommand` with explicit `--allow-empty -m` flags via `shellQuote`.

### Teardown

**Given**: a created Daytona sandbox
**When**: `teardown()` is called
**Then**: deletes the Daytona sandbox via `daytona.delete(sandbox)`, idempotent (second call is a no-op, catches "not found" errors)

### Teardown — ephemeral mode

**Given**: sandbox created with default settings (`autoStopInterval: 30`, `autoDeleteInterval: 0`)
**When**: teardown is called or the sandbox auto-stops
**Then**: the sandbox is fully cleaned up — no orphaned resources

### shellQuote — safe conversion

**Given**: an argv array `["git", "commit", "-m", "it's a \"test\""]`
**When**: `shellQuote()` is called
**Then**: returns `'git' 'commit' '-m' 'it'\''s a "test"'` — each element single-quoted with internal single quotes escaped

### shellQuote — empty args

**Given**: an argv array `["echo", ""]`
**When**: `shellQuote()` is called
**Then**: returns `'echo' ''` — empty strings preserved as empty single-quoted args

### Push+PR — Daytona sandbox

**Given**: a completed blueprint run with `opts.push = true` and `sandboxType === "daytona"`
**When**: the harness executes the push flow
**Then**:
1. Push via SDK: `sandbox.git.push(workDir, "git", githubToken)` — no shell, no credential in command string
2. Create PR via GitHub REST API (`POST /repos/{owner}/{repo}/pulls`) using `githubToken` — no `gh` CLI dependency
3. Returns `PushResult` with `pushed: true` and `prUrl`

### Push+PR — Local sandbox

**Given**: a completed blueprint run with `opts.push = true` and `sandboxType === "local"`
**When**: the harness executes the push flow
**Then**: uses `sandbox.exec(["git", "push", ...])` and `sandbox.exec(["gh", "pr", "create", ...])` (existing tools on host)

### Push+PR — no push flag

**Given**: a completed blueprint run with `opts.push = false`
**When**: the harness completes
**Then**: no push or PR creation occurs (current behaviour, unchanged)

### Push+PR — failure resilience

**Given**: `opts.push = true` but git push fails (auth error, protected branch, etc.)
**When**: the push step runs
**Then**: returns `PushResult` with `pushed: false` and `error: "..."` — does NOT fail the entire run. The code was committed successfully in the sandbox.

### Push+PR — missing GitHub token

**Given**: `opts.push = true` but no `GITHUB_TOKEN` env var and no `opts.githubToken`
**When**: the push step runs
**Then**: returns `PushResult` with `pushed: false` and `error: "GITHUB_TOKEN required for push"` — does not throw

### Push+PR — push succeeds but PR creation fails

**Given**: `opts.push = true` and git push succeeds, but the GitHub REST API PR creation call fails (e.g. network error, permissions, branch already has PR)
**When**: the PR creation step runs
**Then**: returns `PushResult` with `pushed: true`, `prUrl: undefined`, and `error: "PR creation failed: <reason>"` — does not throw

### Push+PR — outcome state model

All four outcome states:

| State | `pushed` | `prUrl` | `error` |
|-------|----------|---------|---------|
| Token missing | `false` | `undefined` | `"GITHUB_TOKEN required for push"` |
| Push failed | `false` | `undefined` | `"git push failed: <reason>"` |
| Push ok, PR failed | `true` | `undefined` | `"PR creation failed: <reason>"` |
| Push ok, PR ok | `true` | `"https://github.com/..."` | `undefined` |

None of these states throw. All are captured in `report.pushResult`. The harness run succeeds regardless.

### Push+PR — PR format

PR title: `[harness] {intent}` (truncated to 256 chars)
PR body:
```
Blueprint: {blueprintName}
Branch: {branch}
Run: {runId}
```

Used by both Daytona (GitHub REST API) and local (`gh pr create`) paths.

## Security Constraints

- **Shell quoting**: `shellQuote()` wraps each argv element in single quotes with proper escaping. No raw string concatenation. This is the only path from argv to Daytona's `executeCommand()`.
- **Path confinement**: All `exec()` cwd and `uploadFiles()` paths validated via `assertPathConfined` locally, before any remote call. Note: lexical validation only — symlink-based bypass inside the container is accepted risk (container is ephemeral and isolated).
- **API key handling**: Daytona API key read from env var or options, never logged or included in reporter output. The existing `redact()` function catches it via the `*KEY*` pattern.
- **GitHub token handling**: The TypeScript API accepts `githubToken` in `SandboxOptions` for programmatic callers. The CLI reads from `GITHUB_TOKEN` env var only — no `--github-token` flag (avoids shell history and `/proc` leakage). Passed to SDK `git.clone()` and `git.push()` as a parameter, never embedded in shell command strings. Caught by `*TOKEN*` redaction pattern in reporters.
- **Env key validation**: All environment variable keys passed to `exec()` are validated against `^[A-Za-z_][A-Za-z0-9_]*$` before command construction. Rejects keys containing `=`, spaces, shell metacharacters, or empty strings.
- **Timeout enforcement**: Daytona's `executeCommand` accepts a timeout in seconds. Convert from ms with `Math.ceil(timeout / 1000)`.
- **Ephemeral by default**: Sandboxes created with `autoStopInterval: 30` and `autoDeleteInterval: 0` (auto-delete on stop) to prevent orphaned resources.
- **Bootstrap cleanup**: If post-create setup (clone, branch) fails, the sandbox is deleted before the error propagates — no orphans on partial failure.
- **No shell: true**: The `shellQuote` utility is the ONLY path to shell command strings. No template literals, no string interpolation. Prefer SDK methods (`git.clone`, `git.push`, `git.commit`, `fs.uploadFiles`) over shelling out wherever possible.

## Acceptance Criteria

1. AC-1: `createDaytonaSandbox()` creates a Daytona sandbox via the SDK
2. AC-2: `sandbox.workDir` is derived from the clone location (not hardcoded)
3. AC-3: `sandbox.exec()` runs commands inside the container with correct cwd and separate stdout/stderr
4. AC-4: `sandbox.exec()` rejects cwd outside workDir (path confinement)
5. AC-5: `sandbox.exec()` returns `timedOut: true` when timeout is exceeded
6. AC-6: `sandbox.uploadFiles()` writes files relative to workDir using `Buffer.from()` and `createFolder("755")`
7. AC-7: `sandbox.uploadFiles()` rejects path traversal attempts
8. AC-8: `sandbox.snapshot()` uses SDK `git.commit()` with explicit message (or `--allow-empty` fallback for empty trees) and returns a non-empty string
9. AC-9: `sandbox.teardown()` deletes the Daytona sandbox
10. AC-10: `sandbox.teardown()` is idempotent (second call is no-op)
11. AC-11: Throws when `DAYTONA_API_KEY` is missing
12. AC-12: Private repos are cloned with GitHub token authentication via SDK `git.clone()`
13. AC-13: `shellQuote()` correctly escapes all special characters (single quotes, double quotes, spaces, backticks, dollar signs)
14. AC-14: `shellQuote()` preserves empty string arguments
15. AC-15: `--push` triggers push + PR creation after blueprint completion (SDK `git.push()` + GitHub REST API for Daytona, `git push` + `gh` for local)
16. AC-16: Push failure returns `PushResult` with error, does not fail the overall run
17. AC-17: Output from exec is truncated to `maxOutput` bytes
18. AC-18: Sandbox is created as ephemeral (auto-deletes on stop)
19. AC-19: Local paths rejected for Daytona sandbox with clear error
20. AC-20: Bootstrap failure (clone/branch) triggers sandbox deletion before re-throw
21. AC-21: CLI reads GitHub token from `GITHUB_TOKEN` env var only (no `--github-token` flag). TypeScript API accepts `githubToken` in `SandboxOptions`.
22. AC-22: `RunReport.pushResult` has typed schema (`pushed`, `prUrl?`, `error?`)
23. AC-23: PR is created against the correct base branch (resolved via GitHub API `GET /repos/{owner}/{repo}` → `default_branch`)
24. AC-24: Env key names validated to `[A-Za-z_][A-Za-z0-9_]*` — reject injection attempts
25. AC-25: Clone uses default branch, then creates harness branch locally (not passed to `git.clone`)

## Test Scenarios

### Unit tests (no Daytona SDK — mock `@daytonaio/sdk`)

```typescript
// tests/daytona-sandbox.test.ts

import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock the Daytona SDK
vi.mock("@daytonaio/sdk", () => {
  const mockSandbox = {
    process: {
      createSession: vi.fn().mockResolvedValue(undefined),
      executeSessionCommand: vi.fn().mockResolvedValue({
        cmdId: "cmd-1",
        exitCode: 0,
      }),
      getSessionCommandLogs: vi.fn().mockImplementation(
        (_sid, _cid, onStdout) => {
          onStdout("hello\n");
          return Promise.resolve();
        },
      ),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      executeCommand: vi.fn().mockResolvedValue({
        result: "hello\n",
        exitCode: 0,
      }),
    },
    fs: {
      uploadFiles: vi.fn().mockResolvedValue(undefined),
      createFolder: vi.fn().mockResolvedValue(undefined),
    },
    git: {
      clone: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      push: vi.fn().mockResolvedValue(undefined),
      createBranch: vi.fn().mockResolvedValue(undefined),
      checkoutBranch: vi.fn().mockResolvedValue(undefined),
    },
    stop: vi.fn().mockResolvedValue(undefined),
  };

  return {
    Daytona: vi.fn().mockImplementation(() => ({
      create: vi.fn().mockResolvedValue(mockSandbox),
      delete: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("createDaytonaSandbox", () => {
  test("AC-1: creates sandbox via SDK", async () => {
    // Given valid options with API key in env
    // When createDaytonaSandbox is called
    // Then Daytona constructor and create() are called
  });

  test("AC-2: workDir is derived from clone path", async () => {
    // Given a created sandbox with repo "org/repo"
    // Then workDir ends with "/repo" (derived from repo name)
  });

  test("AC-4: exec rejects cwd outside workDir", async () => {
    // Given a created sandbox
    // When exec is called with cwd=/etc
    // Then throws path confinement violation
  });

  test("AC-11: throws when API key is missing", async () => {
    // Given no DAYTONA_API_KEY and no apiKey option
    // When createDaytonaSandbox is called
    // Then throws with descriptive message
  });

  test("AC-19: rejects local paths", async () => {
    // Given repo="." or repo="/Users/x/repo"
    // When createDaytonaSandbox is called
    // Then throws with "requires a GitHub repo URL" message
  });

  test("AC-20: bootstrap failure deletes sandbox", async () => {
    // Given SDK create succeeds but git.clone throws
    // When createDaytonaSandbox is called
    // Then daytona.delete is called before error propagates
  });

  test("AC-10: teardown is idempotent", async () => {
    // Given a created sandbox
    // When teardown is called twice
    // Then second call is a no-op (no throw)
  });

  test("AC-8: snapshot uses SDK git.commit with message", async () => {
    // Given a created sandbox
    // When snapshot is called
    // Then git.add and git.commit are called with explicit message
  });
});
```

### shellQuote tests

```typescript
// tests/shell-quote.test.ts

import { describe, test, expect } from "vitest";
import { shellQuote } from "../src/util/shell.js";

describe("shellQuote", () => {
  test("AC-13: simple args", () => {
    expect(shellQuote(["echo", "hello"])).toBe("'echo' 'hello'");
  });

  test("AC-13: single quotes in args", () => {
    expect(shellQuote(["echo", "it's"])).toBe("'echo' 'it'\\''s'");
  });

  test("AC-13: double quotes in args", () => {
    expect(shellQuote(["echo", 'say "hi"'])).toBe("'echo' 'say \"hi\"'");
  });

  test("AC-13: spaces in args", () => {
    expect(shellQuote(["git", "commit", "-m", "fix: the bug"]))
      .toBe("'git' 'commit' '-m' 'fix: the bug'");
  });

  test("AC-13: backticks and dollar signs", () => {
    expect(shellQuote(["echo", "`whoami` $HOME"]))
      .toBe("'echo' '`whoami` $HOME'");
  });

  test("AC-14: empty string arg", () => {
    expect(shellQuote(["echo", ""])).toBe("'echo' ''");
  });

  test("empty argv throws", () => {
    expect(() => shellQuote([])).toThrow(/empty/i);
  });
});
```

### parseGitHubRepo tests

```typescript
// tests/github-util.test.ts

import { describe, test, expect } from "vitest";
import { parseGitHubRepo } from "../src/util/github.js";

describe("parseGitHubRepo", () => {
  test("org/repo shorthand", () => {
    expect(parseGitHubRepo("acme/widgets")).toEqual({ owner: "acme", name: "widgets" });
  });

  test("full HTTPS URL", () => {
    expect(parseGitHubRepo("https://github.com/acme/widgets")).toEqual({ owner: "acme", name: "widgets" });
  });

  test("full HTTPS URL with .git suffix", () => {
    expect(parseGitHubRepo("https://github.com/acme/widgets.git")).toEqual({ owner: "acme", name: "widgets" });
  });

  test("rejects non-GitHub host", () => {
    expect(() => parseGitHubRepo("https://gitlab.com/acme/widgets")).toThrow();
  });

  test("rejects bare name (no slash)", () => {
    expect(() => parseGitHubRepo("widgets")).toThrow();
  });

  test("rejects local path", () => {
    expect(() => parseGitHubRepo("./my-project")).toThrow();
    expect(() => parseGitHubRepo("/Users/x/repo")).toThrow();
  });
});
```

### Push+PR tests

```typescript
// tests/harness-push.test.ts (additions to existing harness tests)

describe("push+PR flow", () => {
  test("AC-15: push triggers git push and PR creation", async () => {
    // Given a mock sandbox and opts.push = true
    // When runHarness completes
    // Then sandbox.git.push (Daytona) or sandbox.exec git push (local) was called
    // And report.pushResult.pushed is true
  });

  test("AC-16: push failure does not fail the run", async () => {
    // Given a mock sandbox where git push fails
    // When runHarness completes
    // Then report.nodes show success for all blueprint nodes
    // And report.pushResult.pushed is false
    // And report.pushResult.error contains the failure reason
  });

  test("AC-21: missing GITHUB_TOKEN returns error, does not throw", async () => {
    // Given opts.push = true and no GITHUB_TOKEN
    // When runHarness completes
    // Then report.pushResult.pushed is false
    // And report.pushResult.error mentions GITHUB_TOKEN
  });

  test("AC-22: pushResult has correct schema", async () => {
    // Given a successful push+PR
    // Then report.pushResult has { pushed: true, prUrl: "https://..." }
  });
});
```

### Integration tests (require DAYTONA_API_KEY)

```typescript
// tests/daytona-sandbox.integration.test.ts
// Skipped in CI unless DAYTONA_API_KEY is set

import { describe, test, expect } from "vitest";
import { createDaytonaSandbox } from "../src/sandbox/daytona.js";

const SKIP = !process.env["DAYTONA_API_KEY"];

describe.skipIf(SKIP)("Daytona sandbox integration", () => {
  test("full lifecycle: create, exec, upload, snapshot, teardown", async () => {
    const sandbox = await createDaytonaSandbox({
      repo: "https://github.com/daytonaio/sdk",
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
```

## Files to Generate

- `src/sandbox/daytona.ts` — `createDaytonaSandbox()` implementation (replace stub)
- `src/util/shell.ts` — `shellQuote()` utility
- `src/util/github.ts` — `parseGitHubRepo()` utility (shared by daytona.ts and harness.ts)
- `tests/daytona-sandbox.test.ts` — unit tests with mocked SDK
- `tests/shell-quote.test.ts` — shellQuote tests
- `tests/github-util.test.ts` — parseGitHubRepo tests
- `tests/harness-push.test.ts` — push+PR flow tests
- `tests/daytona-sandbox.integration.test.ts` — integration tests (skip without API key)

## Files to Modify

- `src/sandbox/types.ts` — add `DaytonaOptions` interface, `githubToken?` to `SandboxOptions`
- `src/harness.ts` — add `githubToken`/`daytona` to `HarnessOptions`, add push+PR flow after blueprint execution
- `src/cli.ts` — read `GITHUB_TOKEN`/`DAYTONA_*` env vars (no CLI flags), pass options through
- `contracts/types.ts` — add `pushResult?` to `RunReport`
- `package.json` — add `@daytonaio/sdk` dependency
- `tests/sandbox-local.test.ts` — remove stub "not yet implemented" test at line 204

## Implementation Notes

### argv-to-shell mapping

Daytona's `executeCommand(command, cwd, env, timeout)` takes a shell command string. Our architecture enforces argv arrays. The `shellQuote()` function bridges this gap by single-quoting each element:

```typescript
export function shellQuote(argv: string[]): string {
  if (argv.length === 0) throw new Error("Empty argv");
  return argv.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(" ");
}
```

This is the standard POSIX single-quote escaping technique. Single-quoted strings pass through literally — no variable expansion, no globbing, no command substitution. The only character that needs escaping inside single quotes is the single quote itself, which is handled by ending the quote, inserting an escaped literal single quote, and reopening the quote.

**Prefer SDK methods over shelling out** wherever possible:
- Git clone → `sandbox.git.clone()`
- Git commit → `sandbox.git.commit()`
- Git push → `sandbox.git.push()`
- File upload → `sandbox.fs.uploadFiles()`
- Directory creation → `sandbox.fs.createFolder()`

Reserve `shellQuote` + `executeCommand`/`executeSessionCommand` for commands that have no SDK equivalent (e.g. `pnpm install`, `pnpm test`, agent CLI invocations).

### Daytona SDK response mapping — exec()

**Primary path (session-based execution):** Use `createSession` / `executeSessionCommand` / `getSessionCommandLogs` to capture stdout and stderr separately. This preserves the `ExecResult` contract that agent drivers depend on.

```typescript
// Pseudocode for session-based exec
const sessionId = `exec-${randomBytes(4).toString("hex")}`;
await daytonaSandbox.process.createSession(sessionId);

// Build command with cwd and env
// cwd: prepend `cd <quoted cwd> &&` to the command
// env: prepend `env KEY=VALUE ...` for each ExecOptions.env entry
// timeout: convert ms → seconds for executeSessionCommand
const cdPrefix = `cd ${shellQuote([cwd])} &&`;
const envPrefix = env
  ? Object.entries(env).map(([k, v]) => `${k}=${shellQuote([v])}`).join(" ") + " "
  : "";
const fullCommand = `${cdPrefix} ${envPrefix}${shellQuote(argv)}`;
const timeoutSec = Math.ceil(timeout / 1000);

const cmd = await daytonaSandbox.process.executeSessionCommand(sessionId, {
  command: fullCommand, runAsync: false, timeout: timeoutSec,
});

let stdout = "", stderr = "";
try {
  await daytonaSandbox.process.getSessionCommandLogs(
    sessionId, cmd.cmdId,
    (chunk) => { stdout += chunk; },
    (chunk) => { stderr += chunk; },
  );
  return { exitCode: cmd.exitCode, stdout, stderr, durationMs, timedOut: false };
} finally {
  await daytonaSandbox.process.deleteSession(sessionId).catch(() => {});
}
```

**Session cleanup**: Every `exec()` call cleans up its session in a `finally` block. `deleteSession` failure is swallowed — the session is ephemeral, and the sandbox will be deleted at teardown anyway.

**cwd handling**: The session starts in the default workdir. We prepend `cd <cwd>` (shell-quoted) to navigate. This mirrors how the local sandbox passes `cwd` to `child_process.execFile`.

**env handling**: Prepend `env K=V` pairs. Values are shell-quoted. Keys are validated against `^[A-Za-z_][A-Za-z0-9_]*$` before command construction — reject any key that doesn't match with error `Invalid env key "<key>" — must match [A-Za-z_][A-Za-z0-9_]*`. This prevents injection via env key names containing `=`, spaces, or shell metacharacters.

**timeout handling**: `executeSessionCommand` accepts a timeout parameter in seconds. On timeout, Daytona kills the process — detect via error type and return `timedOut: true`.

**Debug fallback path (simple execution, behind `DAYTONA_SIMPLE_EXEC=1`):**

| ExecResult field | Daytona source |
|-----------------|----------------|
| `stdout` | `response.result` |
| `stderr` | `""` on success; `response.result` on non-zero exit (duplicate) |
| `exitCode` | `response.exitCode` |
| `durationMs` | Measured locally via `performance.now()` |
| `timedOut` | Catch Daytona timeout error |

### Local path detection

```typescript
function isLocalPath(repo: string): boolean {
  if (repo.startsWith("/") || repo.startsWith("~") || repo.startsWith("./") || repo === ".") return true;
  // No slash at all = bare name, not an org/repo pair
  if (!repo.includes("/")) return true;
  // Windows drive letter
  if (/^[A-Za-z]:/.test(repo)) return true;
  return false;
}
```

### GitHub repo parsing

`parseGitHubRepo(repo: string): { owner: string; name: string }` lives in `src/util/github.ts` (exported, shared). Handles:
- `org/repo` → `{ owner: "org", name: "repo" }`
- `https://github.com/org/repo` → same
- `https://github.com/org/repo.git` → same
- Rejects non-GitHub hosts, bare names, local paths (throws)

Used by `src/sandbox/daytona.ts` (clone path, pushBranch, defaultBranch) and `src/harness.ts` (PR creation endpoint).

### Git clone strategy

When creating the sandbox:
1. Create sandbox from snapshot (no repo yet)
2. Parse repo via `parseGitHubRepo()`, expand to `https://github.com/{owner}/{name}.git`
3. Construct clone path: `/home/daytona/workspace/{name}` — we choose this path, not derive it
4. Clone default branch via SDK `sandbox.git.clone(url, clonePath, undefined, undefined, "git", githubToken)` — do NOT pass the harness branch (it doesn't exist remotely)
5. Set `workDir` = the chosen clone path
6. Create harness branch via SDK `sandbox.git.createBranch(workDir, branchName)` + `sandbox.git.checkoutBranch(workDir, branchName)`

If any step (2-6) fails after sandbox creation, delete the sandbox via `daytona.delete()` before re-throwing.

**Note**: `defaultBranch` is NOT resolved during bootstrap. It is lazy-resolved only when `opts.push === true`, at push time (see Push+PR strategy below).

### Upload files mapping

Our interface: `{ path: string; content: string }[]`
Daytona SDK: `{ source: Buffer; destination: string }[]`

Mapping:
```typescript
for (const f of files) {
  const target = resolve(workDir, f.path);
  assertPathConfined(target, workDir);
  const dir = dirname(target);
  await daytonaSandbox.fs.createFolder(dir, "755");
  await daytonaSandbox.fs.uploadFiles([{
    source: Buffer.from(f.content),
    destination: target,
  }]);
}
```

### Push+PR strategy

**Daytona sandbox** (via `pushBranch` and `defaultBranch` optional methods):
1. `defaultBranch()`: `GET https://api.github.com/repos/{owner}/{repo}` → `default_branch` field (using `githubToken` as Bearer). Lazy — only called when `opts.push === true`. Cached as an instance field after first call; subsequent calls return cached value.
2. `pushBranch(branch, token)`: Use SDK `sandbox.git.push(workDir, "git", token)`. In v1, SDK push is the only path — if it fails (e.g. new branch with no upstream), return non-fatal `PushResult` with `pushed: false` and error. This meets AC-16 cleanly. Askpass fallback deferred to v2 if SDK push proves insufficient for new-branch scenarios.
3. PR creation: HTTP POST to `https://api.github.com/repos/{owner}/{repo}/pulls` with `{ title, body, head: branch, base: defaultBranch }` using `githubToken` as Bearer token. Called from harness (not from sandbox) using `parseGitHubRepo()` for endpoint construction. PR format: title = `[harness] {intent}` (256 char max), body = `Blueprint: {name}\nBranch: {branch}\nRun: {runId}`.

**Local sandbox:**
1. Push: `sandbox.exec({ argv: ["git", "push", "-u", "origin", branch] })`
2. PR: `sandbox.exec({ argv: ["gh", "pr", "create", "--title", ..., "--body", ...] })`

### Warm pool considerations

Default snapshots (`daytona-small`, `daytona-medium`, `daytona-large`) benefit from Daytona's warm pool — near-instant creation. Custom snapshots require building. For harness use, `daytona-medium` (2 vCPU, 4GB RAM, 8GB disk) is the default — sufficient for most TypeScript/Node.js agent workloads.

Consider creating a `harness-node22` custom snapshot with pre-installed:
- Node.js 22 LTS
- pnpm
- Claude Code CLI
- gh (GitHub CLI)

This is a one-time operation:
```typescript
import { Daytona, Image } from "@daytonaio/sdk";
const daytona = new Daytona();
await daytona.snapshot.create({
  name: "harness-node22",
  image: Image.debianSlim("3.12")
    .runCommands(
      "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
      "apt-get install -y nodejs",
      "npm install -g pnpm @anthropic-ai/claude-code",
      "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg",
      "apt-get install -y gh",
    ),
  resources: { cpu: 2, memory: 4, disk: 16 },
});
```

### Error categories

| Error | Handling |
|-------|----------|
| Missing API key | Throw synchronously in factory |
| Local path as repo | Throw synchronously in factory |
| Sandbox creation failure | Throw (let caller handle) |
| Bootstrap failure (clone/branch) | Delete sandbox, then re-throw |
| Command timeout | Return `timedOut: true` in ExecResult |
| Git push failure | Return `PushResult` with error, don't fail run |
| Missing GitHub token for push | Return `PushResult` with error, don't throw |
| Network transient error | Let Daytona SDK retry (built-in) |
| Sandbox already deleted | Swallow in teardown (idempotent) |
