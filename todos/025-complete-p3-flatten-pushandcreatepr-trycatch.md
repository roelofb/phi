---
status: pending
priority: p3
issue_id: "025"
tags: [code-review, simplicity, harness]
dependencies: []
---

# Flatten double try/catch in pushAndCreatePR

## Problem Statement

`pushAndCreatePR()` in `src/harness.ts` has a nested try/catch structure — outer try for the push, inner try for the PR creation. This can be simplified to a single try/catch with early return on push failure.

## Findings

- **Source**: code-simplicity-reviewer
- **Location**: `src/harness.ts` — `pushAndCreatePR()` function

## Proposed Solutions

### Option A: Single try/catch with early return
- Push first, early-return on failure, then create PR
- **Pros**: Flatter control flow, easier to read
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] Single try/catch in pushAndCreatePR
- [ ] Same behavior preserved
- [ ] Tests still pass
