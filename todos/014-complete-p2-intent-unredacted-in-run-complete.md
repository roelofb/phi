---
status: pending
priority: p2
issue_id: "014"
tags: [code-review, security]
dependencies: []
---

# intent field written unredacted in run_complete JSONL event

## Problem Statement

In `src/reporter/json.ts`, the `run_complete` event writes `report.intent` without passing it through `redact()`. The intent comes from user CLI input and could contain secrets (e.g. "deploy with key sk-abc123").

## Findings

- **Source**: security-sentinel
- **Location**: `src/reporter/json.ts` — runComplete handler, line ~136
- `nodeOutput` and `nodeComplete.error` are redacted, but `intent` in the summary is not

## Proposed Solutions

### Option A: Pass intent through redact() before writing
- **Effort**: Small (one function call)
- **Risk**: None

## Acceptance Criteria

- [ ] intent field in run_complete event is redacted
- [ ] Test covers intent containing secret-like values
