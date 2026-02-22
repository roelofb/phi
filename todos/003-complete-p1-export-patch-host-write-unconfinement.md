---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, security]
dependencies: []
---

# export-patch writes to host filesystem without confinement check on ctx.repo

## Problem Statement

In `blueprints/self-build.ts`, the `export-patch` node resolves `ctx.repo` and writes a `.diff` file directly to the host filesystem. There is no `assertPathConfined` check on the output path — a crafted `ctx.repo` could write anywhere.

## Findings

- **Source**: security-sentinel
- **Location**: `blueprints/self-build.ts:203` — `resolve(ctx.repo)`
- `ctx.repo` comes from CLI `--repo` argument, which is user-controlled
- The write uses Node.js `writeFile` (outside sandbox)

## Proposed Solutions

### Option A: Validate ctx.repo is an absolute path and exists before writing
- **Pros**: Prevents traversal, simple check
- **Cons**: Doesn't prevent writing to arbitrary valid paths
- **Effort**: Small
- **Risk**: Low

### Option B: Write patch to sandbox workDir, copy out during teardown
- **Pros**: All writes stay inside sandbox until explicit export
- **Cons**: More complex, patch lost if teardown fails
- **Effort**: Medium
- **Risk**: Medium

## Acceptance Criteria

- [ ] export-patch validates ctx.repo before writing
- [ ] Traversal paths in ctx.repo are rejected
- [ ] Test covers malicious ctx.repo values
