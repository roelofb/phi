---
status: pending
priority: p2
issue_id: "015"
tags: [code-review, consistency]
dependencies: []
---

# Claude Code driver missing maxOutput — will truncate at 50KB default

## Problem Statement

Pi and Codex drivers both set `maxOutput` to 10MB, but `src/agents/claude-code.ts` does not set it at all, falling back to the sandbox default of 50KB (`MAX_OUTPUT_BYTES`). Claude Code with `--output-format json` produces structured JSON that could exceed 50KB for verbose responses.

## Findings

- **Source**: pattern-recognition-specialist
- **Location**: `src/agents/claude-code.ts:92-96` — `sandbox.exec()` call has no `maxOutput`
- Pi uses `PI_MAX_OUTPUT = 10MB`, Codex uses `CODEX_MAX_OUTPUT = 10MB`

## Proposed Solutions

### Option A: Add CLAUDE_MAX_OUTPUT = 10MB to match other drivers
- **Effort**: Small (1 constant + 1 line)
- **Risk**: None

## Acceptance Criteria

- [ ] Claude Code driver sets maxOutput consistently with other drivers
