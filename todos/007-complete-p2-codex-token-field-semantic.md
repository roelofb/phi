---
status: pending
priority: p2
issue_id: "007"
tags: [code-review, correctness]
dependencies: []
---

# Codex parseTokenCount stuffs total into inputTokens

## Problem Statement

`src/agents/codex.ts` parses a single "tokens used" number from Codex output and assigns it entirely to `inputTokens`. This is semantically incorrect — Codex reports total tokens, not input-only.

## Findings

- **Source**: kieran-typescript-reviewer
- **Location**: `src/agents/codex.ts` — `parseTokenCount` function and its usage
- The parsed value should go into a `totalTokens` field or be split heuristically

## Proposed Solutions

### Option A: Add totalTokens field to TokenUsage, use it for Codex
- **Pros**: Semantically correct
- **Cons**: Interface change across codebase
- **Effort**: Medium

### Option B: Rename to clarify it's an approximation, keep in inputTokens
- **Pros**: Minimal change, honest via naming
- **Cons**: Still technically wrong
- **Effort**: Small

## Acceptance Criteria

- [ ] Codex token count is not misattributed to inputTokens
- [ ] TokenUsage accurately represents what each driver reports
