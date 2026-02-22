# Product Spec: Blueprint Engine

## Purpose

Blueprints define the sequence of steps a harness run executes. Each blueprint is a TypeScript module exporting a typed array of nodes. The engine executes these nodes in order, threading context between them. Nodes are typed as `preflight`, `deterministic`, `agentic`, or `validate` — each with different execution semantics.

## Interface

```typescript
// src/blueprint/types.ts

import type { RunContext, NodeResult, ExecOptions } from "../../contracts/types.js";
import type { Sandbox } from "../sandbox/types.js";

/** Node types with different execution semantics */
export type NodeType = "preflight" | "deterministic" | "agentic" | "validate";

/** Base node definition */
export interface BlueprintNode {
  name: string;
  type: NodeType;
  description: string;
  /** Skip this node if condition returns false */
  skip?: (ctx: RunContext) => boolean;
}

/** Preflight: checks prerequisites (auth, git, tools) */
export interface PreflightNode extends BlueprintNode {
  type: "preflight";
  check: (ctx: RunContext, sandbox: Sandbox) => Promise<NodeResult>;
}

/** Deterministic: runs exact commands (lint, test, install) */
export interface DeterministicNode extends BlueprintNode {
  type: "deterministic";
  exec: (ctx: RunContext, sandbox: Sandbox) => Promise<NodeResult>;
}

/** Agentic: invokes an AI agent for judgment calls */
export interface AgenticNode extends BlueprintNode {
  type: "agentic";
  agent: "claude-code" | "pi";
  prompt: (ctx: RunContext) => string;
  /** Additional tools to allow beyond the base set */
  allowedTools?: string[];
}

/** Validate: composite node — run steps, if fail run onFailure agentic, rerun */
export interface ValidateNode extends BlueprintNode {
  type: "validate";
  /** Steps to validate (deterministic commands) */
  steps: Array<{
    name: string;
    exec: (ctx: RunContext, sandbox: Sandbox) => Promise<NodeResult>;
  }>;
  /** Agentic node to run when steps fail */
  onFailure: AgenticNode;
  /** Max retry attempts (default 2) */
  maxRetries?: number;
}

export type AnyNode = PreflightNode | DeterministicNode | AgenticNode | ValidateNode;

/** A blueprint is a named sequence of nodes */
export interface Blueprint {
  name: string;
  description: string;
  nodes: AnyNode[];
}

// src/blueprint/dsl.ts — builder functions

export function blueprint(name: string, description: string, nodes: AnyNode[]): Blueprint;
export function preflight(name: string, description: string, check: PreflightNode["check"]): PreflightNode;
export function deterministic(name: string, description: string, exec: DeterministicNode["exec"]): DeterministicNode;
export function agentic(name: string, description: string, opts: {
  agent: AgenticNode["agent"];
  prompt: AgenticNode["prompt"];
  allowedTools?: string[];
}): AgenticNode;
export function validate(name: string, description: string, opts: {
  steps: ValidateNode["steps"];
  onFailure: AgenticNode;
  maxRetries?: number;
}): ValidateNode;

// src/blueprint/engine.ts

import type { Sandbox } from "../sandbox/types.js";
import type { RunContext, RunReport } from "../../contracts/types.js";

export interface AgentExecutor {
  execute(node: AgenticNode, ctx: RunContext, sandbox: Sandbox): Promise<NodeResult>;
}

export interface EngineOptions {
  sandbox: Sandbox;
  agentExecutor: AgentExecutor;
  /** Called after each node completes */
  onNodeComplete?: (name: string, result: NodeResult) => void;
}

/** Execute a blueprint, returning a full run report */
export function executeBlueprint(
  bp: Blueprint,
  ctx: RunContext,
  opts: EngineOptions
): Promise<RunReport>;
```

## Dependencies

- Foundation Types (`contracts/types.ts`) — `RunContext`, `NodeResult`, `RunReport`
- Sandbox Manager (`src/sandbox/types.ts`) — `Sandbox` interface
- No external npm packages

## Behaviour

### Execute blueprint — happy path

**Given**: a blueprint with 3 nodes (preflight, deterministic, agentic) and all succeed
**When**: `executeBlueprint()` is called
**Then**: nodes execute in order, each node's result is stored in `ctx.results[node.name]`, returns `RunReport` with all nodes successful

### Execute blueprint — node failure halts

**Given**: a blueprint with 3 nodes where the second fails
**When**: `executeBlueprint()` is called
**Then**: the first node executes successfully, the second node fails, the third node is NOT executed, report shows the failure

### Execute blueprint — skip node

**Given**: a blueprint with a node that has `skip` returning `true`
**When**: `executeBlueprint()` is called
**Then**: the node is skipped, its result has status `"skipped"`, subsequent nodes still execute

### Validate node — steps pass

**Given**: a validate node whose steps all succeed
**When**: the engine executes it
**Then**: returns success, `onFailure` agentic is NOT invoked

### Validate node — steps fail, fix succeeds

**Given**: a validate node whose steps fail on first try
**When**: the engine executes it, `onFailure` agentic runs and fixes the issue
**Then**: steps are rerun and pass, returns success, report shows the retry

### Validate node — exhausts retries

**Given**: a validate node whose steps keep failing
**When**: retries are exhausted (default 2)
**Then**: returns failure, report shows all retry attempts

### Context threading

**Given**: node A produces output "foo"
**When**: node B's prompt function accesses `ctx.results["A"]`
**Then**: node B sees `{ status: "success", output: "foo", ... }`

### DSL functions

**Given**: the DSL functions are called
**When**: building a blueprint
**Then**: they return correctly typed node objects

### onNodeComplete callback

**Given**: an `onNodeComplete` callback is provided
**When**: each node finishes
**Then**: the callback is called with the node name and result

## Security Constraints

- All deterministic node exec functions must use argv arrays (enforced by `ExecOptions` type)
- The engine must not catch and swallow errors from node execution — failures must propagate
- `workDir` in context must always match the sandbox's `workDir`

## Acceptance Criteria

1. AC-1: Happy-path blueprint (3 nodes, all pass) returns `RunReport` with all success
2. AC-2: Node failure halts execution — subsequent nodes are not run
3. AC-3: Skipped nodes have status `"skipped"` and don't execute
4. AC-4: Validate node passes on first try → no retry
5. AC-5: Validate node fails → onFailure runs → steps rerun → success on retry
6. AC-6: Validate node exhausts retries → returns failure
7. AC-7: Context threading — later nodes see earlier node results
8. AC-8: `onNodeComplete` callback is invoked for each node
9. AC-9: DSL `blueprint()` returns valid `Blueprint` object
10. AC-10: DSL `preflight()`, `deterministic()`, `agentic()`, `validate()` return correctly typed nodes
11. AC-11: `totalDurationMs` in report is populated

## Test Scenarios

```typescript
// tests/blueprint-engine.test.ts

import { blueprint, preflight, deterministic, agentic, validate } from "../src/blueprint/dsl.js";
import { executeBlueprint } from "../src/blueprint/engine.js";
import type { RunContext, NodeResult } from "../contracts/types.js";
import type { Sandbox } from "../src/sandbox/types.js";
import type { AgentExecutor } from "../src/blueprint/engine.js";

function mockSandbox(): Sandbox {
  return {
    workDir: "/tmp/test",
    exec: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0, timedOut: false }),
    uploadFiles: async () => {},
    snapshot: async () => "snap-1",
    teardown: async () => {},
  };
}

function mockAgent(): AgentExecutor {
  return {
    execute: async () => ({ status: "success", output: "agent done", durationMs: 100 }),
  };
}

function baseContext(): RunContext {
  return {
    runId: "abcd1234",
    workDir: "/tmp/test",
    intent: "test",
    repo: "./test",
    push: false,
    env: {},
    results: {},
  };
}

test("happy path — all nodes succeed", async () => {
  const bp = blueprint("test", "test blueprint", [
    preflight("check-git", "check git", async () => ({ status: "success", output: "ok", durationMs: 1 })),
    deterministic("install", "install deps", async () => ({ status: "success", output: "done", durationMs: 1 })),
  ]);
  const report = await executeBlueprint(bp, baseContext(), {
    sandbox: mockSandbox(),
    agentExecutor: mockAgent(),
  });
  expect(report.nodes).toHaveLength(2);
  expect(report.nodes.every(n => n.status === "success")).toBe(true);
});

test("node failure halts execution", async () => {
  const bp = blueprint("test", "test", [
    deterministic("fail", "fails", async () => ({ status: "failure", output: "err", durationMs: 1, error: "boom" })),
    deterministic("never", "never runs", async () => ({ status: "success", output: "ok", durationMs: 1 })),
  ]);
  const report = await executeBlueprint(bp, baseContext(), {
    sandbox: mockSandbox(),
    agentExecutor: mockAgent(),
  });
  expect(report.nodes).toHaveLength(1);
  expect(report.nodes[0]!.status).toBe("failure");
});

test("skip node", async () => {
  const node = deterministic("skippable", "maybe skip", async () => ({ status: "success", output: "ran", durationMs: 1 }));
  node.skip = () => true;
  const bp = blueprint("test", "test", [node]);
  const report = await executeBlueprint(bp, baseContext(), {
    sandbox: mockSandbox(),
    agentExecutor: mockAgent(),
  });
  expect(report.nodes[0]!.status).toBe("skipped");
});

test("validate node — passes on first try", async () => {
  const bp = blueprint("test", "test", [
    validate("check", "validate", {
      steps: [{ name: "lint", exec: async () => ({ status: "success", output: "ok", durationMs: 1 }) }],
      onFailure: agentic("fix", "fix", { agent: "claude-code", prompt: () => "fix it" }),
    }),
  ]);
  const report = await executeBlueprint(bp, baseContext(), {
    sandbox: mockSandbox(),
    agentExecutor: mockAgent(),
  });
  expect(report.nodes[0]!.status).toBe("success");
});

test("validate node — fails then succeeds on retry", async () => {
  let callCount = 0;
  const bp = blueprint("test", "test", [
    validate("check", "validate", {
      steps: [{
        name: "test",
        exec: async () => {
          callCount++;
          if (callCount === 1) return { status: "failure", output: "fail", durationMs: 1, error: "bad" };
          return { status: "success", output: "ok", durationMs: 1 };
        },
      }],
      onFailure: agentic("fix", "fix", { agent: "claude-code", prompt: () => "fix it" }),
    }),
  ]);
  const report = await executeBlueprint(bp, baseContext(), {
    sandbox: mockSandbox(),
    agentExecutor: mockAgent(),
  });
  expect(report.nodes[0]!.status).toBe("success");
});

test("context threading", async () => {
  let capturedCtx: RunContext | null = null;
  const bp = blueprint("test", "test", [
    deterministic("first", "first", async () => ({ status: "success", output: "hello", durationMs: 1 })),
    deterministic("second", "second", async (ctx) => {
      capturedCtx = ctx;
      return { status: "success", output: "ok", durationMs: 1 };
    }),
  ]);
  await executeBlueprint(bp, baseContext(), {
    sandbox: mockSandbox(),
    agentExecutor: mockAgent(),
  });
  expect(capturedCtx!.results["first"]!.output).toBe("hello");
});
```

## Files to Generate

- `src/blueprint/types.ts` — All blueprint types
- `src/blueprint/dsl.ts` — Builder functions
- `src/blueprint/engine.ts` — `executeBlueprint()` implementation
- `tests/blueprint-engine.test.ts` — All test scenarios above
