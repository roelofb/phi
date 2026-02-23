# Competitive Lanes: DAG Engine with Multi-Agent Evaluation

**Status:** Idea
**Phase:** Post Phase 3
**Depends on:** Blueprint engine, agent drivers, sandbox isolation (all complete)

## Problem

The blueprint engine executes nodes as a linear sequence. One agent per task,
one shot at the answer. No basis for comparing agent quality on real workloads.
No parallelism. No fault tolerance if a single agent hangs or hallucinates.

## Proposal

Generalise the blueprint engine from a sequential executor to a **DAG executor
with competitive parallel lanes**.

```
preflight -> deterministic(clone/install)
                      |
          +-----------+-----------+
          |           |           |
     agentic(Claude) agentic(Pi) agentic(Codex)   <- same prompt, N agents
          |           |           |
          +-----------+-----------+
                      |
               evaluate(pick best)    <- new node type
                      |
               validate(test+lint)
                      |
               deterministic(commit)
```

### Two new DSL combinators

```typescript
// Run nodes in parallel — all must succeed, results collected
parallel(nodeA, nodeB, nodeC)

// Run nodes competitively — best output wins via scoreFn
compete(
  { score: (results: NodeResult[]) => NodeResult },
  nodeA, nodeB, nodeC,
)
```

Existing linear blueprints are a degenerate DAG. Zero breaking changes.

## What this unlocks

| Capability | Mechanism |
|---|---|
| Parallel execution | Independent nodes run concurrently in separate sandboxes |
| Agent competition | Same task dispatched to N agents; best output selected |
| Quality evaluation | `evaluate` node scores outputs (diff size, test pass rate, lint score) |
| Fault tolerance | If one agent fails or times out, others may succeed |
| Benchmarking data | Every competitive run produces head-to-head comparison tuples |
| Adaptive selection | Historical (task_type, agent, score) data enables smart routing |

## Scoring function

The `evaluate` node receives all `NodeResult` outputs and applies a scoring
function. Initial scoring dimensions:

- **Correctness** — does the patch pass the test suite?
- **Parsimony** — diff size (fewer lines changed = better, all else equal)
- **Style** — lint violations in the patch
- **Token efficiency** — tokens consumed to produce the result
- **Duration** — wall-clock time

Weights are blueprint-configurable. Sensible defaults: correctness is
pass/fail gate, then rank by parsimony.

## Compounding flywheel

```
Run N  ->  competitive results  ->  (task_type, agent, score) stored
                                            |
Run N+1  <-  agent selection heuristic  <---+
```

Every competitive run generates evaluation data. Over time, `compete()` can
become `smartPick()` — the system selects the optimal agent per task type
without running all candidates. The harness learns from its own history.

## Engine changes

Current engine contract (simplified):

```typescript
executeBlueprint(nodes: BlueprintNode[], ctx: RunContext): Promise<RunReport>
```

DAG engine contract:

```typescript
executeBlueprint(graph: BlueprintGraph, ctx: RunContext): Promise<RunReport>

interface BlueprintGraph {
  nodes: Map<string, BlueprintNode>
  edges: Map<string, string[]>        // node -> dependencies
  competitive?: Map<string, CompeteConfig>  // group -> scoring fn
}
```

The linear `BlueprintNode[]` compiles to a trivial chain graph. Existing
blueprints work unchanged.

Execution: topological sort, then run all nodes whose dependencies are
satisfied. Competitive groups share a synchronisation barrier — all lanes must
complete (or fail/timeout) before the evaluate node runs.

## Sandbox implications

Each competitive lane needs its own sandbox. For local: parallel git worktrees
(already supported). For Daytona: parallel devbox sessions. Cost scales
linearly with lane count — competitive runs are an explicit trade of compute
for quality signal.

## What makes this radical

Nobody is doing **adversarial multi-agent evaluation at the orchestration
layer**. LLM benchmarks compare agents on synthetic tasks. This compares them
on *your actual production tasks*, inside *your actual codebase*, with *your
actual test suite* as the quality signal.

The harness becomes both the orchestrator and the evaluation platform.

And because this is Phoenix architecture — write the product spec first, tests
second, implementation last. If the implementation is wrong, delete it and
rebuild it using the self-build blueprint. With competitive lanes enabled.

The harness improves itself using the very capability being added.

## Open questions

- **Cost control** — competitive runs multiply agent API costs by lane count.
  Should there be a budget ceiling per run? Per day?
- **Sandbox pooling** — spinning up N sandboxes per run is expensive cold.
  Warm pool / pre-provisioned sandboxes would help.
- **Partial results** — if 2 of 3 agents succeed, do we proceed or wait for
  the third? Configurable timeout with early-winner semantics?
- **Deterministic reproducibility** — parallel execution introduces
  non-determinism in event ordering. Does the reporter need sequence numbers?
- **Graph cycles** — DAGs by definition have none, but the DSL should reject
  cycles at build time with a clear error.

## Implementation sketch

1. Product spec: `docs/product-specs/dag-engine.md`
2. Extend `contracts/types.ts` with `BlueprintGraph`, `CompeteConfig`
3. New file: `src/blueprint/graph.ts` — DAG builder, topo sort, cycle detection
4. Modify `src/blueprint/engine.ts` — parallel dispatch, barrier sync, evaluate
5. New DSL functions in `src/blueprint/dsl.ts` — `parallel()`, `compete()`
6. New file: `src/evaluation/score.ts` — default scoring functions
7. New blueprint: `blueprints/competitive-build.ts` — self-build with 3 agents
8. Tests: graph execution, parallel ordering, competitive selection, fallback on failure
