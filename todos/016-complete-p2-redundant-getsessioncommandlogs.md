---
status: pending
priority: p2
issue_id: "016"
tags: [code-review, performance, daytona]
dependencies: []
---

# Redundant getSessionCommandLogs API call in execSession

## Problem Statement

`execSession()` in `src/sandbox/daytona.ts` calls `getSessionCommandLogs()` after `executeSessionCommand()` with `runAsync: false`. When `runAsync` is false, the execute response already contains `stdout` and `stderr` on the returned object. The extra API call adds latency to every command execution for no benefit.

## Findings

- **Source**: performance-oracle, code-simplicity-reviewer
- **Location**: `src/sandbox/daytona.ts` — `execSession()` function
- `executeSessionCommand` with `runAsync: false` returns `SessionExecuteResponse` which has optional `stdout`/`stderr` fields
- The subsequent `getSessionCommandLogs` call is redundant — the data is already available
- Each exec pays an unnecessary network round-trip

## Proposed Solutions

### Option A: Use stdout/stderr from executeSessionCommand response directly
- **Pros**: Eliminates redundant API call, simpler code
- **Cons**: Must handle optional fields (fallback to empty string)
- **Effort**: Small
- **Risk**: Low — the fields are documented in the SDK types

### Option B: Keep getSessionCommandLogs as fallback only
- **Pros**: More defensive if SDK response is sometimes empty
- **Cons**: Still complex, still slow on the happy path
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] `getSessionCommandLogs` removed from the normal exec path
- [ ] stdout/stderr read from `executeSessionCommand` response
- [ ] Tests still pass
