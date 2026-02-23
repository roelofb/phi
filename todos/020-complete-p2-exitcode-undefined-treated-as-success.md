---
status: pending
priority: p2
issue_id: "020"
tags: [code-review, correctness, daytona]
dependencies: []
---

# cmd.exitCode ?? 0 silently treats undefined as success

## Problem Statement

In `execSession()` in `src/sandbox/daytona.ts`, `cmd.exitCode ?? 0` defaults undefined exit codes to 0 (success). If the SDK fails to populate exitCode, this silently reports success when the command may have failed. A safer default is 1 (failure).

## Findings

- **Source**: kieran-typescript-reviewer
- **Location**: `src/sandbox/daytona.ts` — `execSession()` function
- `SessionExecuteResponse.exitCode` is typed as `number | undefined` in the SDK
- Defaulting to 0 means "assume success" — opposite of fail-safe principle

## Proposed Solutions

### Option A: Default to 1 (failure) instead of 0
- **Pros**: Fail-safe — unknown state treated as error, matches POSIX conventions
- **Cons**: Could cause false negatives if SDK legitimately omits exitCode on success
- **Effort**: Small (one character change)
- **Risk**: Low

## Acceptance Criteria

- [ ] `cmd.exitCode ?? 1` instead of `cmd.exitCode ?? 0`
- [ ] Test updated to reflect new default behavior
