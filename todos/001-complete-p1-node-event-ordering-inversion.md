---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, architecture, correctness]
dependencies: []
---

# nodeOutput fires after nodeComplete — event ordering inversion

## Problem Statement

In `src/harness.ts`, the default agent executor calls `reporter.nodeOutput()` *after* the engine has already called `reporter.nodeComplete()`. This means consumers see completion before the final output, which is semantically wrong and could break streaming consumers.

## Findings

- **Source**: kieran-typescript-reviewer, architecture-strategist
- **Location**: `src/harness.ts` (agentExecutor wrapper) and `src/blueprint/engine.ts` (node execution flow)
- The engine calls `onNodeComplete` at the end of node execution, but the harness wrapper emits `nodeOutput` after returning from the engine call

## Proposed Solutions

### Option A: Move nodeOutput into engine before onNodeComplete
- **Pros**: Single emission path, correct ordering
- **Cons**: Requires engine to accept output callback
- **Effort**: Small
- **Risk**: Low

### Option B: Emit output inside the agentExecutor before returning result
- **Pros**: Minimal change, keeps engine simple
- **Cons**: Still two emission sites
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] nodeOutput always fires before nodeComplete for the same node
- [ ] Deterministic node output also follows this ordering
- [ ] Existing tests updated to assert ordering
