---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, performance]
dependencies: []
---

# JSON reporter runs redact on full output before truncation

## Problem Statement

In `src/reporter/json.ts`, the sanitisation pipeline is `truncate(redact(text, env), MAX_OUTPUT_BYTES)`. This runs the expensive `redact()` function on potentially 10MB of agent output before truncating to 50KB. Should be truncate-first, then redact.

## Findings

- **Source**: performance-oracle
- **Location**: `src/reporter/json.ts` — sanitise helper
- redact() scans for secret patterns across the entire string
- For a 10MB output truncated to 50KB, 99.5% of the redaction work is discarded

## Proposed Solutions

### Option A: Swap order to truncate(text) then redact(truncated, env)
- **Pros**: ~200x less work for large outputs
- **Cons**: Secrets in truncated portion are not redacted (but they're also not emitted)
- **Effort**: Small (swap two function calls)
- **Risk**: None — truncated content isn't written anywhere

## Acceptance Criteria

- [ ] truncate() runs before redact() in JSON reporter
- [ ] Same output for inputs within 50KB limit
- [ ] Performance improvement measurable for large inputs
