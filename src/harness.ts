import type { RunContext, RunReport, NodeResult, TokenUsage } from "../contracts/types.js";
import type { Blueprint, AgenticNode } from "./blueprint/types.js";
import type { AgentExecutor } from "./blueprint/engine.js";
import type { Reporter } from "./reporter/types.js";
import type { Sandbox } from "./sandbox/types.js";
import { executeBlueprint } from "./blueprint/engine.js";
import { createLocalSandbox } from "./sandbox/local.js";
import { createDaytonaSandbox } from "./sandbox/daytona.js";
import { createClaudeCodeDriver } from "./agents/claude-code.js";
import { createPiDriver } from "./agents/pi.js";
import type { AgentResult } from "./agents/types.js";
import { generateRunId } from "./util/preflight.js";
import { slugify } from "./util/sanitize.js";

export interface HarnessOptions {
  blueprint: Blueprint;
  repo: string;
  intent: string;
  push: boolean;
  sandboxType: "local" | "daytona";
  runId?: string;
  env?: Record<string, string>;
  reporter: Reporter;
  specPath?: string;
  /** Override agent executor (for testing) */
  agentExecutor?: AgentExecutor;
}

export async function runHarness(opts: HarnessOptions): Promise<RunReport> {
  const runId = opts.runId ?? generateRunId();
  const bpSlug = slugify(opts.blueprint.name);
  const branch = `harness/${runId}/${bpSlug}`;

  const createSandbox =
    opts.sandboxType === "daytona" ? createDaytonaSandbox : createLocalSandbox;

  const sandbox: Sandbox = await createSandbox({
    repo: opts.repo,
    branch,
  });

  try {
    const claudeDriver = createClaudeCodeDriver();
    const piDriver = createPiDriver();

    const ctx: RunContext = {
      runId,
      workDir: sandbox.workDir,
      intent: opts.intent,
      repo: opts.repo,
      push: opts.push,
      env: opts.env ?? {},
      results: {},
      specPath: opts.specPath,
      sandboxType: opts.sandboxType,
    };

    // Accumulate token usage across all agent invocations
    const totalTokens: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    const agentExecutor: AgentExecutor = opts.agentExecutor ?? {
      execute: async (
        node: AgenticNode,
        nodeCtx: RunContext,
        nodeSandbox: Sandbox,
      ): Promise<NodeResult> => {
        const driver = node.agent === "pi" ? piDriver : claudeDriver;
        const prompt = node.prompt(nodeCtx);

        const result: AgentResult = await driver.execute(nodeSandbox, prompt, {
          allowedTools: node.allowedTools,
        });

        // Accumulate tokens from every agent call (including onFailure retries)
        totalTokens.inputTokens += result.tokenUsage.inputTokens;
        totalTokens.outputTokens += result.tokenUsage.outputTokens;
        totalTokens.cacheReadTokens += result.tokenUsage.cacheReadTokens;
        totalTokens.cacheWriteTokens += result.tokenUsage.cacheWriteTokens;

        return result;
      },
    };

    const report = await executeBlueprint(opts.blueprint, ctx, {
      sandbox,
      agentExecutor,
      onNodeStart: (name, type) => {
        opts.reporter.nodeStart(name, type);
      },
      onNodeComplete: (name, result) => {
        opts.reporter.nodeComplete(name, result);
        if (result.output) {
          opts.reporter.nodeOutput(name, result.output);
        }
      },
    });

    // Merge accumulated token usage into report
    const finalReport: RunReport = {
      ...report,
      branch,
      tokenUsage: totalTokens,
    };
    opts.reporter.runComplete(finalReport);
    return finalReport;
  } finally {
    await sandbox.teardown();
  }
}
