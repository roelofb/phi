---
status: pending
priority: p3
issue_id: "021"
tags: [code-review, simplicity, daytona]
dependencies: []
---

# Remove execSimple debug fallback (YAGNI)

## Problem Statement

`execSimple()` in `src/sandbox/daytona.ts` is a ~33-line fallback gated behind `DAYTONA_SIMPLE_EXEC=1` env var. It has no tests, no documentation, and no production use case. It adds dead code that must be maintained.

## Findings

- **Source**: code-simplicity-reviewer
- **Location**: `src/sandbox/daytona.ts` — `execSimple()` function and dispatch in `exec()`
- Untested code path
- YAGNI — can be re-added if needed

## Proposed Solutions

### Option A: Delete execSimple and the env-var dispatch
- **Pros**: ~33 fewer lines, simpler exec path, no untested code
- **Cons**: Loses a debug escape hatch (trivially re-addable)
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] `execSimple()` function removed
- [ ] `DAYTONA_SIMPLE_EXEC` dispatch removed from `exec()`
- [ ] Tests still pass
