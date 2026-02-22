---
status: pending
priority: p3
issue_id: "012"
tags: [code-review, robustness]
dependencies: []
---

# Codex stderr banner filtering is fragile

## Problem Statement

The Codex driver filters stderr by checking for specific banner text ("OpenAI Codex"). If Codex changes their banner format, the filter breaks and the banner appears as an error.

## Findings

- **Source**: pattern-recognition-specialist
- **Location**: `src/agents/codex.ts` — stderr filtering logic

## Proposed Solutions

### Option A: Filter all non-empty stderr lines that don't look like errors
- **Effort**: Small
- **Risk**: Could suppress real errors

### Option B: Only use stderr for error reporting when exitCode !== 0
- **Effort**: Small
- **Risk**: Low — stderr is noise when exit is 0

## Acceptance Criteria

- [ ] Codex banner doesn't appear as error message
- [ ] Real Codex errors are still captured
