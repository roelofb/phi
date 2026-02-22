---
status: pending
priority: p2
issue_id: "004"
tags: [code-review, architecture]
dependencies: []
---

# Token aggregation split between harness and engine

## Problem Statement

Token accumulation happens in the harness's default `agentExecutor` closure, while the engine returns hardcoded zeros. An injected `agentExecutor` (test seam) bypasses accumulation entirely, meaning test runs never see token data. The split makes the system harder to reason about.

## Findings

- **Source**: architecture-strategist, pattern-recognition-specialist
- **Location**: `src/harness.ts` (accumulator closure), `src/blueprint/engine.ts:60` (zeros)
- Injectable executor is documented as a test seam but silently drops token tracking

## Proposed Solutions

### Option A: Move accumulation into engine (single path)
- **Pros**: All executors get token tracking, simpler mental model
- **Cons**: Engine needs to know about token types
- **Effort**: Medium

### Option B: Document the bypass, add token accumulation to test helpers
- **Pros**: Minimal change
- **Cons**: Doesn't fix the architectural split
- **Effort**: Small

## Acceptance Criteria

- [ ] Token usage is tracked regardless of executor injection
- [ ] Test seam doesn't silently drop data
