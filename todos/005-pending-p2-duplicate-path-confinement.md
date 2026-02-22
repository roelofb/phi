---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, architecture, duplication]
dependencies: []
---

# Duplicate path confinement logic in JSON reporter

## Problem Statement

`src/reporter/json.ts` has its own `hasTraversalSegment` + `resolveReporterPath` instead of reusing `assertPathConfined` from `src/util/path.ts`. Two independent implementations of the same security check.

## Findings

- **Source**: architecture-strategist, code-simplicity-reviewer, pattern-recognition-specialist
- **Location**: `src/reporter/json.ts` (lines ~20-45), `src/util/path.ts`
- The reporter's version checks for `..` segments manually; the util version uses `path.relative`

## Proposed Solutions

### Option A: Replace reporter path validation with assertPathConfined
- **Pros**: Single implementation, tested, proven
- **Cons**: Slightly different error messages
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] JSON reporter uses assertPathConfined from src/util/path.ts
- [ ] Custom path validation code removed from json.ts
- [ ] Existing reporter tests still pass
