---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, architecture, liskov]
dependencies: []
---

# Pi and Codex drivers silently ignore allowedTools

## Problem Statement

The `AgentDriver` interface accepts `allowedTools` in options, but Pi hardcodes a fixed tool list and Codex uses `--full-auto` (all tools). Callers believe they're restricting the agent's capabilities, but the restriction is silently ignored. Liskov substitution violation.

## Findings

- **Source**: architecture-strategist, pattern-recognition-specialist, kieran-typescript-reviewer
- **Location**: `src/agents/pi.ts:20-22`, `src/agents/codex.ts`
- Pi: `if (options?.allowedTools?.length)` → pushes hardcoded `"read,bash,edit,write,grep,find,ls"`
- Codex: `--full-auto` ignores all tool restrictions

## Proposed Solutions

### Option A: Map allowedTools to driver-native format where possible, warn on unsupported
- **Pros**: Best effort mapping, transparent about limitations
- **Cons**: Mapping is imperfect across drivers
- **Effort**: Medium

### Option B: Document the limitation, add runtime warning
- **Pros**: Honest, minimal code
- **Cons**: Doesn't fix the actual problem
- **Effort**: Small

## Acceptance Criteria

- [ ] Pi driver either maps allowedTools or warns when ignoring them
- [ ] Codex driver documents or warns about --full-auto override
- [ ] Blueprint authors can reason about actual tool restrictions
