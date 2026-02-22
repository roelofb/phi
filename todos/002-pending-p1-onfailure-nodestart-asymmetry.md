---
status: pending
priority: p1
issue_id: "002"
tags: [code-review, architecture, correctness]
dependencies: []
---

# onNodeStart not called for onFailure nodes — event asymmetry

## Problem Statement

When the validate node triggers `onFailure`, the engine calls `onNodeComplete` for the fix result but never calls `onNodeStart`. This breaks the start/complete contract that reporters depend on.

## Findings

- **Source**: architecture-strategist, kieran-typescript-reviewer
- **Location**: `src/blueprint/engine.ts` — `executeValidateNode` function
- onFailure result is emitted via `onNodeComplete` (added in Phase 2) but the matching `onNodeStart` is missing

## Proposed Solutions

### Option A: Add onNodeStart call before onFailure execution
- **Pros**: Symmetric start/complete, reporters can track timing
- **Cons**: None
- **Effort**: Small (1 line)
- **Risk**: Low

## Acceptance Criteria

- [ ] onNodeStart fires before onFailure agent executes
- [ ] onNodeComplete fires after onFailure completes
- [ ] Test verifies start/complete pairing for onFailure nodes
