import type { RunContext, NodeResult, RunReport } from "../../contracts/types.js";
import type { Sandbox } from "../sandbox/types.js";
import type { Blueprint, AgenticNode, AnyNode } from "./types.js";

export interface AgentExecutor {
  execute(
    node: AgenticNode,
    ctx: RunContext,
    sandbox: Sandbox,
  ): Promise<NodeResult>;
}

export interface EngineOptions {
  sandbox: Sandbox;
  agentExecutor: AgentExecutor;
  /** Called after each node completes */
  onNodeComplete?: (name: string, result: NodeResult) => void;
}

/** Execute a blueprint, returning a full run report */
export async function executeBlueprint(
  bp: Blueprint,
  ctx: RunContext,
  opts: EngineOptions,
): Promise<RunReport> {
  const nodeResults: Array<{ name: string } & NodeResult> = [];
  const start = performance.now();

  for (const node of bp.nodes) {
    // Check skip condition
    if (node.skip?.(ctx)) {
      const skipped: NodeResult = {
        status: "skipped",
        output: "",
        durationMs: 0,
      };
      nodeResults.push({ name: node.name, ...skipped });
      ctx.results[node.name] = skipped;
      opts.onNodeComplete?.(node.name, skipped);
      continue;
    }

    const result = await executeNode(node, ctx, opts);
    nodeResults.push({ name: node.name, ...result });
    ctx.results[node.name] = result;
    opts.onNodeComplete?.(node.name, result);

    if (result.status === "failure") {
      break;
    }
  }

  return {
    runId: ctx.runId,
    blueprint: bp.name,
    repo: ctx.repo,
    intent: ctx.intent,
    nodes: nodeResults,
    totalDurationMs: Math.round(performance.now() - start),
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    push: ctx.push,
  };
}

async function executeNode(
  node: AnyNode,
  ctx: RunContext,
  opts: EngineOptions,
): Promise<NodeResult> {
  switch (node.type) {
    case "preflight":
      return node.check(ctx, opts.sandbox);
    case "deterministic":
      return node.exec(ctx, opts.sandbox);
    case "agentic":
      return opts.agentExecutor.execute(node, ctx, opts.sandbox);
    case "validate":
      return executeValidateNode(node, ctx, opts);
  }
}

async function executeValidateNode(
  node: Extract<AnyNode, { type: "validate" }>,
  ctx: RunContext,
  opts: EngineOptions,
): Promise<NodeResult> {
  const maxRetries = node.maxRetries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const stepResults: NodeResult[] = [];
    let allPassed = true;

    for (const step of node.steps) {
      const result = await step.exec(ctx, opts.sandbox);
      stepResults.push(result);
      if (result.status === "failure") {
        allPassed = false;
        break;
      }
    }

    if (allPassed) {
      const totalDuration = stepResults.reduce(
        (sum, r) => sum + r.durationMs,
        0,
      );
      return {
        status: "success",
        output: stepResults.map((r) => r.output).join("\n"),
        durationMs: totalDuration,
      };
    }

    // Last attempt — no more retries
    if (attempt === maxRetries) {
      const failedStep = stepResults.find((r) => r.status === "failure");
      return {
        status: "failure",
        output: stepResults.map((r) => r.output).join("\n"),
        durationMs: stepResults.reduce((sum, r) => sum + r.durationMs, 0),
        error: failedStep?.error ?? "Validation failed after max retries",
      };
    }

    // Run onFailure agentic to try to fix
    await opts.agentExecutor.execute(node.onFailure, ctx, opts.sandbox);
  }

  // Unreachable, but TypeScript needs it
  return {
    status: "failure",
    output: "",
    durationMs: 0,
    error: "Unexpected: exhausted validate loop",
  };
}
