---
status: pending
priority: p3
issue_id: "024"
tags: [code-review, correctness, daytona]
dependencies: []
---

# pushBranch ignores _branch parameter

## Problem Statement

`pushBranch(branch, token)` in `src/sandbox/daytona.ts` accepts a `branch` parameter but passes only `workDir` to `sdkSandbox.git.push()`. The branch parameter is unused (prefixed with `_`). This is misleading — callers expect to control which branch is pushed.

## Findings

- **Source**: kieran-typescript-reviewer, pattern-recognition-specialist
- **Location**: `src/sandbox/daytona.ts` — `pushBranch()` method
- The SDK's `git.push(path, username?, password?)` pushes the current branch at `path`
- If the correct branch was already checked out during bootstrap, this works — but the unused param is confusing

## Proposed Solutions

### Option A: Remove branch parameter from the interface
- Change signature to `pushBranch(token: string)` since we always push the current branch
- **Pros**: Honest API, no misleading parameters
- **Cons**: Interface change affects Sandbox type
- **Effort**: Medium (type change propagates)
- **Risk**: Low

### Option B: Document that branch is ignored
- Add comment explaining current-branch semantics
- **Pros**: No code change
- **Cons**: Still misleading
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] Either branch param removed or documented as unused
- [ ] No misleading API surface
