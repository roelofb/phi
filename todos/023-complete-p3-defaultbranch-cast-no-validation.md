---
status: pending
priority: p3
issue_id: "023"
tags: [code-review, correctness, daytona]
dependencies: []
---

# defaultBranch() uses `as` cast with no runtime validation

## Problem Statement

`defaultBranch()` in `src/sandbox/daytona.ts` casts the GitHub REST API response with `as { default_branch: string }` without verifying the field exists or is a string. A 404, rate limit, or API change would silently produce `undefined`.

## Findings

- **Source**: kieran-typescript-reviewer
- **Location**: `src/sandbox/daytona.ts` — `defaultBranch()` function
- The `as` cast suppresses type checking at the boundary

## Proposed Solutions

### Option A: Add runtime check after fetch
- Verify `typeof data.default_branch === "string"` and throw if not
- **Pros**: Fail-fast on unexpected API responses
- **Cons**: Minor verbosity
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] Runtime validation of `default_branch` field after fetch
- [ ] Throws meaningful error on unexpected response
