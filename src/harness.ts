import type { RunContext, RunReport, NodeResult } from "../contracts/types.js";
import type { Blueprint, AgenticNode } from "./blueprint/types.js";
import type { Reporter } from "./reporter/types.js";
import type { Sandbox } from "./sandbox/types.js";
import { executeBlueprint } from "./blueprint/engine.js";
import { createLocalSandbox } from "./sandbox/local.js";
import { createDaytonaSandbox } from "./sandbox/daytona.js";
import { createClaudeCodeDriver } from "./agents/claude-code.js";
import { createPiDriver } from "./agents/pi.js";
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
    };

    const report = await executeBlueprint(opts.blueprint, ctx, {
      sandbox,
      agentExecutor: {
        execute: async (
          node: AgenticNode,
          nodeCtx: RunContext,
          nodeSandbox: Sandbox,
        ): Promise<NodeResult> => {
          const driver = node.agent === "pi" ? piDriver : claudeDriver;
          const prompt = node.prompt(nodeCtx);
          opts.reporter.nodeStart(node.name, node.type);

          const result = await driver.execute(nodeSandbox, prompt, {
            allowedTools: node.allowedTools,
          });

          if (result.output) {
            opts.reporter.nodeOutput(node.name, result.output);
          }

          return result;
        },
      },
      onNodeComplete: (name, result) => {
        opts.reporter.nodeComplete(name, result);
      },
    });

    const finalReport: RunReport = { ...report, branch };
    opts.reporter.runComplete(finalReport);
    return finalReport;
  } finally {
    await sandbox.teardown();
  }
}
