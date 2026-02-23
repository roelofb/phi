# Agentic DX: What Would Make This Remarkable

**Status:** Design notes
**Context:** The harness works. 128 tests, three phases, self-build proven. The
question is what elevates it from "solid orchestrator" to "the reference
implementation for agentic developer experience."

---

## The Honest Assessment

The harness has excellent bones: clean contracts, sandbox isolation, validate-
with-retry, token tracking, security primitives. But it treats agents as **black
boxes that eat strings and produce strings.** This is the fundamental
constraint everything else inherits.

```typescript
// Today: everything is string → string
prompt: (ctx: RunContext) => string      // prompt is text
output: string                           // result is text
ctx.results["plan"]?.output ?? ""        // downstream reads text
```

Every node produces `{ status, output: string, durationMs }`. The plan node
outputs prose. The implement node pattern-matches that prose. If the plan
format drifts, downstream nodes silently degrade. There's no schema, no
validation, no type safety between nodes.

This is the single thing to fix. Everything else follows.

---

## 1. Structured Artifacts Protocol

**The idea:** Nodes produce typed artifacts, not strings.

```typescript
// Instead of output: string
interface NodeArtifact<T = unknown> {
  /** Human-readable summary (for reporters, logs) */
  summary: string
  /** Structured, typed payload (for downstream nodes) */
  data: T
  /** Files created or modified (paths relative to workDir) */
  files?: string[]
}

// Plan node declares its output shape
interface PlanArtifact {
  approach: string
  filesToCreate: string[]
  filesToModify: string[]
  risks: string[]
  estimatedComplexity: "low" | "medium" | "high"
}

// Implement node receives typed input
agentic("implement", "Generate code from spec", {
  agent: "pi",
  // ctx.artifact<PlanArtifact>("plan") — type-checked at build time
  prompt: (ctx) => {
    const plan = ctx.artifact<PlanArtifact>("plan")
    return buildPrompt(plan)  // structured, not string interpolation
  },
})
```

**Why this matters for DX:**
- Blueprint authors get autocomplete on upstream node outputs
- Runtime validation catches schema drift before the agent runs
- Reporters can render structured diffs, not wall-of-text
- Evaluation becomes programmatic: did the plan cover all spec requirements?

**Migration:** `NodeResult.output` stays for backwards compat. Add optional
`artifact?: NodeArtifact` alongside it. Nodes that don't produce structured
output continue working. Gradual adoption.

---

## 2. Checkpoint & Resume

**The problem:** A run fails at node 5 of 7. You restart from scratch. The
agent re-reads the codebase, re-installs deps, re-plans — burning tokens and
time on work already done.

**The idea:** Every node boundary is an implicit checkpoint. The engine
serialises `(RunContext, sandbox snapshot)` after each successful node. Resume
from any checkpoint.

```bash
# Run fails at validate
pnpm harness run --blueprint self-build --repo . --intent "..." --spec foo.md
# ... fails at validate node, prints checkpoint ID

# Resume from last good checkpoint, skip nodes 1-4
pnpm harness resume --checkpoint ckpt_a1b2c3d4

# Or resume from a specific node
pnpm harness resume --checkpoint ckpt_a1b2c3d4 --from implement
```

**Implementation sketch:**
- After each successful node: `sandbox.snapshot()` + serialise context to
  `runs/{runId}/checkpoints/{nodeName}.json`
- Resume: deserialise context, restore snapshot, execute remaining nodes
- Local sandbox: git stash/tag per checkpoint
- Daytona: workspace snapshot (already supported in SDK)

**Why this matters for DX:**
- Failed runs don't waste the work of successful nodes
- Prompt iteration becomes fast: change the implement prompt, resume from plan
- Debugging: checkpoint before the failing node, inspect sandbox state
- Cost control: don't re-burn tokens on nodes that already succeeded

---

## 3. The Phoenix Proof

**The problem:** The architecture *claims* code is regenerable from specs. This
has been demonstrated once (JSON reporter). It has never been proven
continuously and automatically.

**The idea:** A `phoenix-proof` blueprint that systematically validates the
regeneration hypothesis.

```
pick random src/ file
    → snapshot current tests + spec
    → delete the file
    → run self-build with the corresponding spec
    → compare: do all original tests still pass?
    → compare: is the regenerated code equivalent? (same API, same behaviour)
    → report: regeneration score (0-100)
```

Run this as a scheduled CI job. Track the regeneration score over time. If a
spec becomes insufficient (regeneration fails), the spec is the bug — not the
code.

**Why this matters:**
- It's the first automated proof that specs are sufficient for regeneration
- It catches spec drift before it matters
- It's a genuinely novel contribution — nobody else is doing this
- It validates the entire Phoenix architecture thesis with data, not faith
- It's recursive: the harness proves its own philosophy using itself

---

## 4. Agent Trace Protocol

**The problem:** When an agent runs, you get stdout. You don't see what it
read, what tools it called, what it tried and abandoned, where it spent its
tokens.

```
// Today's reporter events
nodeStart("implement", "agentic")
nodeOutput("implement", "...2KB of agent stdout...")
nodeComplete("implement", { status: "success" })
```

An agent might spend 80% of its tokens re-reading files it already read in the
plan node. You'd never know.

**The idea:** Capture a structured trace of agent actions alongside the result.

```typescript
interface AgentTrace {
  /** Ordered sequence of agent actions */
  actions: AgentAction[]
  /** Token usage broken down by phase */
  tokenBreakdown: {
    fileReads: number
    toolCalls: number
    reasoning: number
    output: number
  }
}

type AgentAction =
  | { type: "file_read"; path: string; lines: number }
  | { type: "file_write"; path: string; diff: string }
  | { type: "tool_call"; tool: string; args: unknown; result: string }
  | { type: "search"; query: string; results: number }
  | { type: "reasoning"; summary: string }
```

**How to capture:** Agent CLIs already emit structured logs:
- Claude Code: `~/.claude/projects/*/session.jsonl`
- Codex: structured output with `--json`
- Pi: session transcripts

Parse these after the agent completes. Don't require agents to change their
output format — post-process what they already emit.

**Why this matters for DX:**
- Debug failed runs by inspecting the trace, not guessing
- Identify token waste (repeated file reads, redundant searches)
- Compare agent strategies on the same task
- Feed traces back as context: "in a previous run, you read these files"

---

## 5. Prompt as First-Class Entity

**The problem:** Prompts are anonymous lambdas embedded in blueprint files.

```typescript
// Today: prompt is a closure in the blueprint
prompt: (ctx) => `Read the spec at: ${ctx.specPath}\nGenerate code...`
```

You can't version prompts independently from blueprints. You can't A/B test
two prompts on the same blueprint. You can't see which prompt produced which
result.

**The idea:** Prompts are named, versioned, stored alongside specs.

```
prompts/
  self-build/
    plan.v1.md        # "Read ARCHITECTURE.md, read spec, list files..."
    plan.v2.md        # Revised after observing poor plans
    implement.v1.md
    implement.v2.md
    fix-failures.v1.md
```

Blueprint references prompts by name and version:

```typescript
agentic("plan", "Plan implementation", {
  agent: "pi",
  prompt: prompt("self-build/plan", "v2"),
})
```

Run reports record which prompt version was used. Over time, you can correlate
prompt versions with success rates.

**Why this matters for DX:**
- Prompt engineering becomes diffable, reviewable, versionable
- A/B testing: run same blueprint with prompt v1 vs v2, compare results
- Prompt library: share effective prompts across blueprints
- Aligns with Phoenix: prompts are durable artifacts, like specs

---

## 6. Adaptive Node Insertion

**The problem:** Blueprints are static sequences defined at build time. But
real tasks need conditional logic.

```
If the plan mentions database changes → insert a migration node
If the spec references external APIs → insert a mock-setup node
If the codebase has no tests → insert a test-scaffold node
```

Today, you'd need a separate blueprint for each variant.

**The idea:** Blueprints can declare **conditional nodes** that activate based
on upstream artifacts.

```typescript
conditionalNode("migration", {
  when: (ctx) => ctx.artifact<PlanArtifact>("plan").filesToCreate
    .some(f => f.includes("migration")),
  node: deterministic("run-migration", "Apply migration", ...),
})
```

This is strictly more expressive than the current model. Static blueprints are
the degenerate case (all conditions are `() => true`).

**Depends on:** Structured Artifacts (#1) — conditions need typed data to
inspect.

---

## Priority Stack

If I had to pick three, in order:

| # | Addition | Why |
|---|----------|-----|
| 1 | **Structured Artifacts** | Unlocks everything else. Type safety between nodes. Programmatic evaluation. Conditional logic. Non-negotiable foundation. |
| 2 | **Checkpoint & Resume** | Biggest DX win per effort. Halves iteration time on failed runs. Makes prompt experimentation cheap. |
| 3 | **Phoenix Proof** | The bold move. Proves the architecture thesis with data. Genuinely novel. Good for the soul. |

Items 4–6 are force multipliers but depend on the first three.

---

## What "Super Proud" Looks Like

A release where:

- A blueprint author gets **type errors** if they reference an upstream node's
  output incorrectly — before any agent runs
- A failed run at node 5 **resumes in seconds** from a checkpoint, not minutes
  from scratch
- A CI job **deletes a random source file every night** and the harness
  rebuilds it from spec — and the team barely notices
- An agent trace shows **exactly why** a run failed: "spent 40K tokens re-
  reading files the plan node already summarised"
- Prompt changes are **reviewed in PRs** with success rate data from previous
  runs

That's the system where every piece makes every other piece better. The
structured artifacts enable evaluation, evaluation enables prompt improvement,
prompt improvement enables higher regeneration scores, higher scores validate
the architecture, which justifies investing more in specs.

The flywheel.
