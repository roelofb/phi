---
status: pending
priority: p3
issue_id: "009"
tags: [code-review, patterns, duplication]
dependencies: []
---

# Zero-token literal repeated 8+ times across drivers

## Problem Statement

The `{ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }` literal appears in every agent driver return path. Should be a shared constant.

## Findings

- **Source**: pattern-recognition-specialist
- **Location**: `src/agents/pi.ts` (3x), `src/agents/codex.ts` (2x), `src/agents/claude-code.ts` (3x)

## Proposed Solutions

### Option A: Export ZERO_TOKEN_USAGE from agents/types.ts
- **Effort**: Small
- **Risk**: None

## Acceptance Criteria

- [ ] Single `ZERO_TOKEN_USAGE` constant used across all drivers
