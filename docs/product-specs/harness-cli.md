# Product Spec: Harness CLI

## Purpose

The CLI is the entry point for the harness. It wires together the sandbox, blueprint engine, agent drivers, and reporter to execute a full harness run. It also provides commands for listing available blueprints and performing dry runs.

## Interface

```typescript
// src/util/github.ts — Repo argument resolution

/** If repo is a local path, resolve to owner/repo via git origin remote. Pass-through otherwise. */
export function resolveRepoArg(repo: string): Promise<string>;

/** Parse owner/repo, GitHub URL, or SSH URL into { owner, name }. */
export function parseGitHubRepo(repo: string): { owner: string; name: string };

// src/cli.ts — CLI entry point using citty

// Commands:
//   harness run     — Execute a blueprint
//   harness list    — List available blueprints
//   harness dry-run — Show what would execute without running

// src/harness.ts — Orchestrator

import type { RunContext, RunReport } from "../contracts/types.js";
import type { Blueprint } from "./blueprint/types.js";
import type { Reporter } from "./reporter/types.js";

export interface HarnessOptions {
  blueprint: Blueprint;
  repo: string;
  intent: string;
  push: boolean;
  sandboxType: "local" | "daytona";
  runId?: string;
  env?: Record<string, string>;
  reporter: Reporter;
  /** Path to a spec file (for self-build blueprint) */
  specPath?: string;
}

/** Execute a full harness run */
export function runHarness(opts: HarnessOptions): Promise<RunReport>;

// blueprints/bug-fix.ts

import type { Blueprint } from "../src/blueprint/types.js";
export const bugFix: Blueprint;

// blueprints/self-build.ts

import type { Blueprint } from "../src/blueprint/types.js";
export const selfBuild: Blueprint;
```

## Dependencies

- Foundation Types (`contracts/types.ts`)
- Sandbox Manager (`src/sandbox/`)
- Blueprint Engine (`src/blueprint/`)
- Agent Drivers (`src/agents/`)
- Reporter (`src/reporter/`)
- `citty` — CLI framework
- Node.js built-ins: `fs/promises`, `path`, `process`

## Behaviour

### CLI — repo resolution

**Given**: `--repo` is a local path (`.`, `./foo`, `/abs/path`)
**When**: `harness run` is executed
**Then**: the CLI resolves the path to `owner/repo` via `git remote get-url origin` before passing to `runHarness()`

**Given**: `--repo` is already `owner/repo` or a GitHub URL
**When**: `harness run` is executed
**Then**: the value is passed through unchanged

**Rationale**: Users run from inside a repo. Forcing them to type the GitHub slug is friction. The CLI layer resolves; `runHarness()` always receives a GitHub reference.

### CLI — run command

**Given**: valid `--blueprint`, `--repo`, `--intent` flags
**When**: `harness run` is executed
**Then**: loads the blueprint, creates a sandbox, executes the blueprint, reports results, tears down sandbox

### CLI — run with --push

**Given**: `--push` flag is set
**When**: the blueprint completes successfully
**Then**: the branch is pushed and a PR is created via `gh pr create`

### CLI — run without --push (default)

**Given**: `--push` is not set (default)
**When**: the blueprint completes
**Then**: outputs a diff/patch, does NOT push or create PR

### CLI — list command

**Given**: blueprints exist in the `blueprints/` directory
**When**: `harness list` is executed
**Then**: prints blueprint names and descriptions

### CLI — dry-run command

**Given**: valid `--blueprint`, `--repo`, `--intent` flags
**When**: `harness dry-run` is executed
**Then**: prints the sequence of nodes that would execute, without executing them

### CLI — run-id generation

**Given**: `--run-id` is not provided
**When**: a run starts
**Then**: an 8-char hex run ID is generated via `generateRunId()`

### CLI — branch naming

**Given**: a run with runId `abcd1234` and blueprint `bug-fix`
**When**: the sandbox is created
**Then**: the branch name is `harness/abcd1234/bug-fix`

### Harness orchestrator — happy path

**Given**: valid options
**When**: `runHarness()` is called
**Then**: creates sandbox → executes blueprint → reports → tears down sandbox (in try/finally)

### Harness orchestrator — teardown on failure

**Given**: a blueprint that fails mid-execution
**When**: `runHarness()` is called
**Then**: sandbox teardown still runs (try/finally)

### Harness orchestrator — agent wiring

**Given**: a blueprint with agentic nodes
**When**: the engine encounters an agentic node
**Then**: the appropriate driver (claude-code or pi) is invoked based on `node.agent`

### Bug-fix blueprint

**Given**: a repo and intent describing a bug
**When**: the `bug-fix` blueprint runs
**Then**: executes: preflight (git/auth check) → deterministic (clone/install) → agentic (investigate) → agentic (implement) → validate (lint + test, with agentic fix on failure) → deterministic (commit)

### Self-build blueprint

**Given**: a spec path and the harness repo itself
**When**: the `self-build` blueprint runs
**Then**: executes: preflight → deterministic (read spec) → agentic (plan) → agentic (implement) → validate (typecheck + test, with agentic fix on failure) → deterministic (commit)

## Security Constraints

- `--push` must be explicitly provided; default is patch-only
- Branch names are sanitised via `slugify()`
- Environment variables with secret patterns are redacted in all output
- Sandbox teardown is guaranteed via try/finally in `runHarness()`

## Acceptance Criteria

1. AC-1: `runHarness()` creates a sandbox and tears it down in try/finally
2. AC-2: `runHarness()` executes the blueprint and returns a `RunReport`
3. AC-3: Branch name follows pattern `harness/<runId>/<blueprint-name>`
4. AC-4: Without `--push`, no git push or PR creation occurs
5. AC-5: `harness list` outputs available blueprints with descriptions
6. AC-6: `harness dry-run` shows node sequence without executing
7. AC-7: Run ID is auto-generated if not provided
8. AC-8: Agentic nodes are routed to the correct driver (claude-code or pi)
9. AC-9: `bug-fix` blueprint has correct node sequence
10. AC-10: `self-build` blueprint has correct node sequence
11. AC-11: Sandbox teardown runs even on blueprint failure
12. AC-12: `--repo .` resolves to `owner/repo` via git origin remote
13. AC-13: `--repo owner/repo` passes through unchanged
14. AC-14: SSH remote URLs (`git@github.com:owner/repo.git`) are parsed correctly

## Test Scenarios

```typescript
// tests/harness.test.ts

import { runHarness } from "../src/harness.js";
import type { Blueprint } from "../src/blueprint/types.js";
import type { Reporter } from "../src/reporter/types.js";
import { blueprint, preflight, deterministic } from "../src/blueprint/dsl.js";

function mockReporter(): Reporter {
  return {
    nodeStart: () => {},
    nodeOutput: () => {},
    nodeComplete: () => {},
    runComplete: () => {},
  };
}

test("runHarness returns RunReport on success", async () => {
  const bp = blueprint("test", "test blueprint", [
    deterministic("step1", "do thing", async () => ({
      status: "success",
      output: "done",
      durationMs: 1,
    })),
  ]);
  const report = await runHarness({
    blueprint: bp,
    repo: process.cwd(), // use current dir as a git repo for testing
    intent: "test intent",
    push: false,
    sandboxType: "local",
    reporter: mockReporter(),
  });
  expect(report.runId).toMatch(/^[0-9a-f]{8}$/);
  expect(report.nodes).toHaveLength(1);
  expect(report.nodes[0]!.status).toBe("success");
});

test("runHarness tears down sandbox on failure", async () => {
  let tornDown = false;
  // We test this indirectly — if teardown didn't happen, temp dirs would leak
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
    repo: process.cwd(),
    intent: "test",
    push: false,
    sandboxType: "local",
    reporter: mockReporter(),
  });
  expect(report.nodes[0]!.status).toBe("failure");
  // If we get here without hanging, teardown worked
});

test("branch naming follows convention", async () => {
  const bp = blueprint("my-blueprint", "test", [
    deterministic("step", "step", async (ctx) => ({
      status: "success",
      output: ctx.workDir,
      durationMs: 1,
    })),
  ]);
  const report = await runHarness({
    blueprint: bp,
    repo: process.cwd(),
    intent: "test",
    push: false,
    sandboxType: "local",
    runId: "deadbeef",
    reporter: mockReporter(),
  });
  expect(report.branch).toMatch(/^harness\/deadbeef\/my-blueprint$/);
});
```

## Files to Generate

- `src/harness.ts` — `runHarness()` orchestrator
- `src/cli.ts` — CLI entry point with `run`, `list`, `dry-run` commands
- `blueprints/bug-fix.ts` — Bug-fix blueprint definition
- `blueprints/self-build.ts` — Self-build blueprint definition
- `tests/harness.test.ts` — All test scenarios above
