---
status: pending
priority: p3
issue_id: "026"
tags: [code-review, ux, reporter]
dependencies: []
---

# Console reporter does not print pushResult

## Problem Statement

After a `--push` run, `runComplete` in `src/reporter/console.ts` prints branch but not `pushResult`. The user gets no console feedback about whether the PR was created or its URL.

## Findings

- **Source**: architecture-strategist
- **Location**: `src/reporter/console.ts:31-47` — `runComplete()` method
- `pushResult` is available on `RunReport` but never displayed

## Proposed Solutions

### Option A: Print PR URL and push status in runComplete
- If `report.pushResult?.pushed`, print the PR URL
- If `report.pushResult?.error`, print the error
- **Pros**: User sees outcome immediately
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] Successful push shows PR URL in console output
- [ ] Failed push shows error in console output
- [ ] No push shows nothing extra
