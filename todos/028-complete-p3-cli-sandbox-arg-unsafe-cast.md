---
status: pending
priority: p3
issue_id: "028"
tags: [code-review, correctness, cli]
dependencies: []
---

# `args.sandbox as "local" | "daytona"` is an unsafe cast

## Problem Statement

In `src/cli.ts:95`, `args.sandbox` is cast to `"local" | "daytona"` without validation. If the user passes `--sandbox foobar`, it silently flows through to `createSandbox` which falls back to `createLocalSandbox` — confusing behaviour.

## Findings

- **Source**: kieran-typescript-reviewer
- **Location**: `src/cli.ts:95`

## Proposed Solutions

### Option A: Validate before casting
- Check `["local", "daytona"].includes(args.sandbox)` and throw on invalid values
- **Pros**: Fail-fast, clear error message
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] Invalid `--sandbox` value throws with helpful error
- [ ] Valid values work unchanged
