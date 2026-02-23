---
status: pending
priority: p3
issue_id: "027"
tags: [code-review, simplicity, dead-code]
dependencies: []
---

# Remove dead type fields, constants, and redundant isLocalPath

## Problem Statement

Several type fields and constants are defined but never used. The `isLocalPath` function duplicates validation already handled by `parseGitHubRepo`.

## Findings

- **Source**: code-simplicity-reviewer
- **Locations**:
  - `src/sandbox/types.ts:36` — `DaytonaOptions.resources` never read
  - `src/sandbox/types.ts:45` — `SandboxOptions.operationTimeout` never read
  - `src/sandbox/types.ts:53,56` — `DEFAULT_OPERATION_TIMEOUT`, `DEFAULT_RUN_TIMEOUT` never imported
  - `src/sandbox/daytona.ts:15-20` — `isLocalPath()` duplicates `parseGitHubRepo` validation
  - `src/sandbox/daytona.ts:30-32` — `isLocalPath` call redundant (parseGitHubRepo rejects same inputs 4 lines later)
  - `src/sandbox/daytona.ts:145` — `const token = githubToken` pointless alias

## Proposed Solutions

### Option A: Delete all dead code
- Remove unused type fields, constants, `isLocalPath`, and the alias
- **Pros**: ~15 fewer lines, cleaner interface, less cognitive load
- **Cons**: None — all confirmed unused
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] `resources` field removed from DaytonaOptions
- [ ] `operationTimeout` field removed from SandboxOptions
- [ ] `DEFAULT_OPERATION_TIMEOUT` and `DEFAULT_RUN_TIMEOUT` removed
- [ ] `isLocalPath` function and its call removed
- [ ] `const token = githubToken` alias removed
- [ ] Typecheck and tests pass
