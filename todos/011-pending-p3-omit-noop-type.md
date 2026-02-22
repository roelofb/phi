---
status: pending
priority: p3
issue_id: "011"
tags: [code-review, typescript]
dependencies: []
---

# Omit<NodeCompleteEvent, "timestamp"> is a no-op

## Problem Statement

In `src/reporter/json.ts`, there's an `Omit<NodeCompleteEvent, "timestamp">` type that doesn't actually omit anything because `NodeCompleteEvent` may not have a `timestamp` field, making the Omit a no-op.

## Findings

- **Source**: kieran-typescript-reviewer
- **Location**: `src/reporter/json.ts`

## Proposed Solutions

### Option A: Remove the Omit wrapper if timestamp isn't on the type
- **Effort**: Small
- **Risk**: None

## Acceptance Criteria

- [ ] No-op type utilities removed
