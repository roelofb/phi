# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm test                        # run all tests (vitest)
pnpm test -- tests/harness.test.ts  # run a single test file
pnpm test -- -t "node name"     # run tests matching a pattern
pnpm typecheck                   # tsgo --noEmit (strict, uses native TS preview)
pnpm lint                        # oxlint across src/ contracts/ tests/ blueprints/
pnpm harness run --blueprint self-build --repo . --intent "..." --spec docs/product-specs/foo.md
pnpm harness dry-run --blueprint self-build  # preview blueprint nodes
pnpm harness list                # list available blueprints
```

Typecheck uses `tsgo` (the native TypeScript preview compiler), not `tsc`. Always get full output — never tail.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full philosophy, invariants, and directory conventions.

This is a **harness engineering** system: an orchestrator that turns intent into working code via autonomous agent loops running in isolated sandboxes. The codebase follows the **Phoenix Architecture** — specs, tests, and contracts are durable; `src/` is regenerable.

### Core flow

```
CLI (citty) → runHarness() → createSandbox() → executeBlueprint() → push+PR
```

### Key layers

| Layer | Location | Role |
|-------|----------|------|
| Contracts | `contracts/types.ts` | Shared types: RunContext, NodeResult, RunReport, ExecOptions |
| Blueprints | `blueprints/*.ts` | Named sequences of nodes (preflight → deterministic → agentic → validate) |
| Blueprint DSL | `src/blueprint/dsl.ts` | Builder functions: `blueprint()`, `preflight()`, `deterministic()`, `agentic()`, `validate()` |
| Blueprint Engine | `src/blueprint/engine.ts` | Executes nodes sequentially; validate nodes retry with onFailure agentic loops |
| Agent Drivers | `src/agents/{claude-code,pi,codex}.ts` | Spawn CLI agents in sandbox; parse output for token usage |
| Sandbox | `src/sandbox/{local,daytona}.ts` | Isolation: local uses git worktrees in tmpdir; Daytona uses remote devboxes |
| Reporter | `src/reporter/{console,json}.ts` | Emit events: nodeStart, nodeOutput, nodeComplete, runComplete |
| CLI | `src/cli.ts` | citty-based CLI with `run`, `list`, `dry-run` subcommands |

### Node types in blueprints

- **preflight** — checks prerequisites (tools, auth, spec file exists)
- **deterministic** — exact commands (install, lint, commit)
- **agentic** — dispatches to an agent driver (claude-code, pi, codex) with a prompt function
- **validate** — composite: runs deterministic steps, on failure invokes an onFailure agentic node, retries up to maxRetries

### Sandbox interface

`Sandbox` (`src/sandbox/types.ts`) is the isolation abstraction: `exec()`, `uploadFiles()`, `snapshot()`, `teardown()`, optional `pushBranch()` and `defaultBranch()`. All commands go through `sandbox.exec()` as argv arrays — no shell strings. Path confinement is enforced via `assertPathConfined()`.

### Path aliases

- `@contracts/*` → `./contracts/*`
- `@src/*` → `./src/*`

Vitest resolves these via `vitest.config.ts` aliases. TSConfig uses `paths`.

## Conventions

- ESM-only (`"type": "module"`); all local imports use `.js` extensions
- Strict TypeScript: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- Commands passed as `argv: string[]` arrays, never shell strings — `shell: false` is enforced
- Output truncation via `truncate()` from `src/util/sanitize.ts` with `MAX_OUTPUT_BYTES`
- Path traversal protection via `assertPathConfined()` from `src/util/path.ts`
- Tests live in `tests/` (flat), named `*.test.ts`; integration tests use `*.integration.test.ts`
- Product specs in `docs/product-specs/`; architecture in `docs/ARCHITECTURE.md`
- Learnings captured in `docs/solutions/` with YAML frontmatter

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop

- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness
- Run /compound-engineering:workflows:review

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation. Required to pass to the /codex-review skill
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections. Required to pass to the /compound-docs skill too

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Clone/push + PR creation |
| `DAYTONA_API_KEY` | Daytona sandbox provisioning |
| `DAYTONA_API_URL` | Daytona endpoint override |
| `DAYTONA_TARGET` | Daytona target region |
