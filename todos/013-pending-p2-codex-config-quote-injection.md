---
status: pending
priority: p2
issue_id: "013"
tags: [code-review, security]
dependencies: []
---

# Codex --config system_prompt susceptible to quote injection

## Problem Statement

`src/agents/codex.ts` embeds `systemPrompt` inside a `--config` key=value string with double quotes: `system_prompt="${options.systemPrompt}"`. If systemPrompt contains double quotes, it could inject additional config keys into the Codex CLI.

## Findings

- **Source**: security-sentinel
- **Location**: `src/agents/codex.ts:31-33`
- Not a shell injection (execFile, shell:false) but could alter Codex's own config parsing
- Example: systemPrompt of `" other_config="malicious` → `system_prompt="" other_config="malicious"`

## Proposed Solutions

### Option A: Escape or reject double quotes in systemPrompt
- **Effort**: Small
- **Risk**: Low

### Option B: Use a dedicated flag if Codex supports one (e.g. --system-prompt)
- **Effort**: Small (if flag exists)
- **Risk**: None

## Acceptance Criteria

- [ ] systemPrompt with double quotes does not alter Codex config parsing
- [ ] Test covers systemPrompt containing special characters
