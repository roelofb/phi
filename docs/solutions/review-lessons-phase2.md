---
problem: Patterns discovered during Phase 2 multi-agent code review
symptoms: [event ordering bugs, security gaps, duplicated logic, performance waste]
root_cause: First-pass implementation prioritised getting the loop working over polish
solution: 15 findings resolved across P1/P2/P3 — patterns documented below
date: 2026-02-22
tags: [code-review, architecture, security, performance, agents]
---

# Phase 2 Code Review Lessons

## Event Ordering Matters
Reporter consumers expect `start → output → complete` per node. The harness was emitting
`nodeOutput` after `nodeComplete` — streaming consumers saw completion before content.
**Rule:** Always emit output before completion for the same node.

## Symmetric Callbacks
If `onNodeComplete` fires for a sub-node (like `onFailure`), `onNodeStart` must also fire.
Asymmetric start/complete breaks reporters that track timing or pair events.

## Token Accumulation Must Be a Decorator
Don't bake token accumulation into the default executor closure — an injected executor
silently bypasses it. Wrap *any* executor with accumulation so all paths are covered.

## Don't Duplicate Security Primitives
The JSON reporter had its own path confinement logic (`hasTraversalSegment` + relative check)
duplicating `assertPathConfined`. One implementation, reused everywhere.

## Truncate Before Redact
`redact(truncate(text))` runs expensive regex redaction on potentially 10MB of output
that will be truncated to 50KB anyway. Truncate first, then redact the smaller string.

## Host Filesystem Writes Need Confinement
Any write outside the sandbox (like `export-patch`) must `assertPathConfined` the output path.
`ctx.repo` is user-controlled via CLI `--repo` flag.

## Agent Driver Consistency Checklist
When adding a new driver, verify:
- `maxOutput` set (default 50KB is too small for agents)
- `ZERO_TOKEN_USAGE` used for error/timeout paths
- `allowedTools` either mapped or documented as unsupported
- `systemPrompt` safely escaped for the CLI's argument format
- `child.stdin?.end()` called (some CLIs block on open stdin)

## Driver Dispatch
Use a `Record<string, AgentDriver>` map, not ternary chains. Adding a new agent should be
a single map entry, not edits to a conditional chain.

## Codex Specifics
- `--full-auto` grants all tools — `allowedTools` cannot be restricted
- Reports `tokens used\nN,NNN` in stdout — total only, no input/output split
- `--config system_prompt="..."` needs embedded double quotes escaped
- stderr on non-zero exit is the error; stderr on success is banner noise

## Pi Specifics
- `--print --no-session` for ephemeral runs
- Blocks on open stdin even in `--print` mode — must close stdin
- Fixed tool set: `read,bash,edit,write,grep,find,ls`
- Auth via `~/.pi/agent/auth.json` (OAuth auto-refresh)
- Cannot report token usage (returns zeros)

## Claude Code Specifics
- Cannot nest inside itself (`CLAUDECODE` env var detection)
- `--output-format json` produces structured output with token counts
- `--allowedTools` is the only driver that properly maps `allowedTools`
