---
status: pending
priority: p3
issue_id: "010"
tags: [code-review, patterns]
dependencies: []
---

# Ternary chain for driver dispatch should be a registry map

## Problem Statement

In `src/harness.ts`, driver selection is a ternary chain: `node.agent === "pi" ? piDriver : node.agent === "codex" ? codexDriver : claudeDriver`. Adding a fourth agent requires editing this chain.

## Findings

- **Source**: pattern-recognition-specialist
- **Location**: `src/harness.ts` — agentExecutor

## Proposed Solutions

### Option A: Record<string, AgentDriver> lookup map
- **Effort**: Small
- **Risk**: None

## Acceptance Criteria

- [ ] Driver dispatch uses a map, not conditionals
- [ ] Adding a new driver is a single map entry
