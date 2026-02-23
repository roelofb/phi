---
status: pending
priority: p2
issue_id: "017"
tags: [code-review, performance, daytona]
dependencies: []
---

# Session-per-exec creates 3+ API round-trips per command

## Problem Statement

Every `exec()` call in `src/sandbox/daytona.ts` creates a new session, executes the command, fetches logs, then deletes the session — 4 API calls minimum. For blueprints with many nodes, this multiplies latency significantly. A single long-lived session would reduce this to 1 call per exec.

## Findings

- **Source**: performance-oracle
- **Location**: `src/sandbox/daytona.ts` — `execSession()` function
- Flow per exec: `createSession` → `executeSessionCommand` → `getSessionCommandLogs` → `deleteSession`
- If finding #016 is addressed (remove getSessionCommandLogs), it's still 3 calls per exec
- A persistent session created during bootstrap and deleted during teardown would reduce to 1 call per exec

## Proposed Solutions

### Option A: Persistent session — create once, reuse for all execs
- **Pros**: 3x fewer API calls, significant latency reduction
- **Cons**: Must handle session expiry/reconnection; session cleanup in teardown
- **Effort**: Medium
- **Risk**: Medium — session lifecycle management adds complexity

### Option B: Session pool with lazy creation
- **Pros**: Resilient to session failures, self-healing
- **Cons**: Over-engineered for current use case
- **Effort**: Large
- **Risk**: Low

## Acceptance Criteria

- [ ] Single session reused across exec calls within one sandbox
- [ ] Session created lazily or during bootstrap
- [ ] Session cleaned up in teardown
- [ ] Existing tests still pass
