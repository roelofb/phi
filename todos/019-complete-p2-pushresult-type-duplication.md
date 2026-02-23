---
status: pending
priority: p2
issue_id: "019"
tags: [code-review, architecture, types]
dependencies: []
---

# PushResult type duplicated between harness.ts and contracts/types.ts

## Problem Statement

`PushResult` is defined as a local interface in `src/harness.ts` and also declared inline on `RunReport.pushResult` in `contracts/types.ts`. If one changes, the other may drift. The single source of truth should be `contracts/types.ts`.

## Findings

- **Source**: architecture-strategist, pattern-recognition-specialist
- **Location**: `src/harness.ts` (local `PushResult` interface) and `contracts/types.ts` (`pushResult?` field on `RunReport`)
- Both define `{ pushed: boolean; prUrl?: string; error?: string }` independently

## Proposed Solutions

### Option A: Export PushResult from contracts/types.ts, import in harness.ts
- **Pros**: Single source of truth, DRY
- **Cons**: None meaningful
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] `PushResult` exported from `contracts/types.ts`
- [ ] `src/harness.ts` imports and uses it
- [ ] No duplicate type definition
- [ ] Typecheck passes
