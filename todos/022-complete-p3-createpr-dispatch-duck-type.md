---
status: pending
priority: p3
issue_id: "022"
tags: [code-review, architecture, harness]
dependencies: []
---

# createPR dispatch should duck-type instead of checking sandboxType

## Problem Statement

`createPR()` in `src/harness.ts` uses `opts.sandboxType === "daytona" || sandbox.defaultBranch` to decide between REST API and `gh` CLI paths. This conflates type identity with capability. If a future sandbox type also supports `defaultBranch`, the condition breaks.

## Findings

- **Source**: architecture-strategist, pattern-recognition-specialist
- **Location**: `src/harness.ts` — `createPR()` function
- Duck-typing on `sandbox.defaultBranch` alone would be sufficient and more extensible

## Proposed Solutions

### Option A: Duck-type on sandbox.defaultBranch only
- Check `if (sandbox.defaultBranch)` → REST API path; else → `gh` CLI path
- **Pros**: Capability-based dispatch, no sandbox type coupling
- **Cons**: None meaningful
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] `createPR` dispatches based on `sandbox.defaultBranch` existence only
- [ ] No reference to `sandboxType` in createPR
- [ ] Tests still pass
