# Architecture

This document describes the high-level architecture, key decisions, and the principles that guide how we build and maintain this system.

## Philosophy: The Phoenix Architecture

> **The code is not the asset. The specification and evaluation are the asset.**

This codebase is designed to be **regenerable**. Any implementation can be deleted and rebuilt from specifications, evaluations, and encoded patterns. The goal is for deletion to be boring.

### What Survives Deletion (Durable)

These artifacts carry understanding and must be maintained:

```
docs/
├── product-specs/        ← What we're building and why
├── exec-plans/           ← How we decided to build it
├── ARCHITECTURE.md       ← Boundaries and invariants
└── DESIGN.md             ← Visual language and patterns

.pi/skills/               ← Encoded patterns (regenerate implementations)
tests/                    ← Evaluations (the oracle for correctness)
contracts/types           ← Interfaces that define boundaries
```

### What's Regenerable (Transient)

Code is a cache — a materialized view of understanding:

```
src/                      ← Can be regenerated from specs + skills
```

**Rule:** If knowledge only exists in the implementation, it's not knowledge — it's risk.

### The Deletion Test

Ask yourself:

> If I deleted this component and asked an agent to regenerate it, what would I rely on to decide whether the result was correct?

If the answer is "the old code," then understanding lives in the wrong place. Move it to:
- A product spec (`docs/product-specs/`)
- An evaluation (test)
- A skill (`.pi/skills/`)
- An invariant (this document)

### Yield Over Throughput

Throughput is how much you produce. **Yield is how much survives.**

We optimize for yield:
- Deletion must be ordinary
- Replacement must be bounded
- Drift is detected and compacted
- Understanding compounds, code is disposable

---

## Agent-First Development

This codebase is optimized for agent legibility. Humans steer, agents execute.

### Harness Engineering

The harness is the orchestration layer that turns intent into working code via autonomous agent loops running in isolated sandboxes.

```
Intent (ticket/Slack/CLI)
    │
    ▼
Harness (orchestrator)
    │
    ├─► Provision sandbox (Daytona devbox)
    ├─► Clone repo + install deps
    ├─► Run blueprint (deterministic + agentic nodes)
    │       │
    │       ├─► [deterministic] Lint, typecheck
    │       ├─► [agentic] Plan implementation
    │       ├─► [agentic] Implement + self-correct loop
    │       ├─► [deterministic] Run tests/CI
    │       └─► [agentic] Fix failures (max N retries)
    │
    ├─► Commit + open PR with explanation
    └─► Teardown or snapshot sandbox
```

Properties:
- **Isolated execution**: Each agent run gets its own sandbox (no blast radius)
- **Hybrid orchestration**: Blueprints mix deterministic steps with agentic judgment
- **Shift-left feedback**: Catch failures locally before CI
- **Fresh context per step**: No context window bloat
- **Compounding**: Each cycle improves future cycles via captured learnings

### Repository as System of Record

Agents can only see what's in the repository. External knowledge must be encoded:

| External Knowledge | Encode As |
|--------------------|-----------|
| Slack discussion about approach | `docs/exec-plans/` decision log |
| Design feedback | `docs/product-specs/` update |
| Bug fix learnings | `.pi/skills/` or `docs/solutions/` |
| API documentation | `docs/references/*.txt` (LLM-friendly) |

**If the agent can't see it, it doesn't exist.**

---

## Architectural Invariants

These constraints are mechanically enforced. Violations fail CI.

| Invariant | Rationale | Enforcement |
|-----------|-----------|-------------|
| Parse at boundaries | Type safety, agent legibility | Strict types, schemas |
| Interfaces over implementations | Replaceability, testing | Code review |
| Specs before code | Phoenix: understanding is durable | Workflow gates |
| Tests as oracle | Regenerability requires correctness proofs | CI |

---

## Key Decisions

### Why harness engineering?

- 10x throughput potential (see: Stripe Minions, OpenAI harness engineering)
- Forces explicit specifications
- Knowledge compounds instead of decaying
- Deletion becomes safe

### Why Daytona for sandboxes?

- Sub-90ms cold starts for tight agent feedback loops
- Unlimited persistence (no session caps)
- Programmatic SDKs (Python/TS/Go/Ruby)
- Snapshots + fork for parallel exploration
- Claude Code integration guides
- EU regions for compliance

### Why blueprints (hybrid orchestration)?

Inspired by Stripe's Minions architecture:
- Deterministic nodes conserve tokens and guarantee completion of critical subtasks
- Agentic nodes handle judgment calls (implementation, failure resolution)
- Teams can customize blueprints per project/domain
- Reduces non-determinism where it doesn't add value

---

## Directory Conventions

```
pi-harness-engineering/
├── docs/                 # System of record (Phoenix: durable)
│   ├── ARCHITECTURE.md   # This file — boundaries and invariants
│   ├── exec-plans/       # How we're building it
│   │   ├── active/       # In-progress plans
│   │   └── completed/    # Reference for patterns
│   ├── product-specs/    # What we're building
│   ├── solutions/        # Captured learnings (searchable)
│   └── references/       # External docs (LLM-friendly format)
├── src/                  # Implementation (Phoenix: transient/regenerable)
├── tests/                # Evaluations (Phoenix: durable)
├── contracts/            # Type interfaces (Phoenix: durable)
└── .pi/                  # Agent infrastructure
    ├── skills/           # Encoded patterns
    └── prompts/          # Workflow commands
```

---

## Compound Learnings Proactively

**Don't wait to be asked.** When debugging or fixing issues, capture learnings immediately.

**Trigger conditions — compound when:**
- Debugging takes >10 minutes
- Root cause wasn't obvious
- We patch something that could break again
- We discover undocumented behavior

**How to compound:**
1. Create `docs/solutions/<problem-slug>.md` with YAML frontmatter:
   ```yaml
   ---
   problem: Brief description
   symptoms: [what you observed]
   root_cause: Why it happened
   solution: How we fixed it
   date: YYYY-MM-DD
   tags: [relevant, tags]
   ---
   ```
2. Include verification steps so future agents can confirm the fix still applies

**Why:** Learnings happen when debugging, not when workflows complete. Compound immediately or context is lost.

---

## Validation Gates

Before any code is merged:

```bash
pnpm lint        # Lint + format check
pnpm typecheck   # Strict mode
pnpm test        # Unit + integration tests
```

---

## References

- [Harness Engineering (OpenAI)](https://openai.com/index/harness-engineering/) — Agent-first development at scale
- [The Phoenix Architecture](https://aicoding.leaflet.pub) — Regenerative software principles
- [Minions: Stripe's Coding Agents](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2) — Production unattended agents
- [Trillion Dollar AI Dev Stack (a16z)](https://a16z.com/the-trillion-dollar-ai-software-development-stack/) — Ecosystem overview
