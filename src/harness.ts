import type { RunContext, RunReport, NodeResult, TokenUsage, PushResult } from "../contracts/types.js";
import type { Blueprint, AgenticNode } from "./blueprint/types.js";
import type { AgentExecutor } from "./blueprint/engine.js";
import type { Reporter } from "./reporter/types.js";
import type { Sandbox, DaytonaOptions } from "./sandbox/types.js";
import { executeBlueprint } from "./blueprint/engine.js";
import { createLocalSandbox } from "./sandbox/local.js";
import { createDaytonaSandbox } from "./sandbox/daytona.js";
import { createClaudeCodeDriver } from "./agents/claude-code.js";
import { createPiDriver } from "./agents/pi.js";
import { createCodexDriver } from "./agents/codex.js";
import type { AgentResult } from "./agents/types.js";
import { generateRunId } from "./util/preflight.js";
import { slugify } from "./util/sanitize.js";
import { parseGitHubRepo } from "./util/github.js";

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
  /** GitHub PAT for clone/push. Read from GITHUB_TOKEN env var in CLI. */
  githubToken?: string;
  /** Daytona-specific configuration. Ignored when sandboxType === "local". */
  daytona?: DaytonaOptions;
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
    daytona: opts.daytona,
    githubToken: opts.githubToken,
  });

  try {
    const claudeDriver = createClaudeCodeDriver();
    const piDriver = createPiDriver();
    const codexDriver = createCodexDriver();

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

    const drivers: Record<string, typeof claudeDriver> = {
      "claude-code": claudeDriver,
      pi: piDriver,
      codex: codexDriver,
    };

    const baseExecutor: AgentExecutor = opts.agentExecutor ?? {
      execute: async (
        node: AgenticNode,
        nodeCtx: RunContext,
        nodeSandbox: Sandbox,
      ): Promise<NodeResult> => {
        const driver = drivers[node.agent] ?? claudeDriver;
        const prompt = node.prompt(nodeCtx);

        const result: AgentResult = await driver.execute(nodeSandbox, prompt, {
          allowedTools: node.allowedTools,
        });

        return result;
      },
    };

    // Wrap any executor (including injected ones) with token accumulation
    const agentExecutor: AgentExecutor = {
      execute: async (node, nodeCtx, nodeSandbox) => {
        const result = await baseExecutor.execute(node, nodeCtx, nodeSandbox);
        // Accumulate tokens if the result carries tokenUsage (AgentResult)
        const agentResult = result as Partial<AgentResult>;
        if (agentResult.tokenUsage) {
          totalTokens.inputTokens += agentResult.tokenUsage.inputTokens;
          totalTokens.outputTokens += agentResult.tokenUsage.outputTokens;
          totalTokens.cacheReadTokens += agentResult.tokenUsage.cacheReadTokens;
          totalTokens.cacheWriteTokens += agentResult.tokenUsage.cacheWriteTokens;
        }
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
        if (result.output) {
          opts.reporter.nodeOutput(name, result.output);
        }
        opts.reporter.nodeComplete(name, result);
      },
    });

    // Push+PR flow (after blueprint, before teardown)
    let pushResult: PushResult | undefined;
    if (opts.push) {
      pushResult = await pushAndCreatePR(sandbox, ctx, branch, opts);
    }

    // Merge accumulated token usage into report
    const finalReport: RunReport = {
      ...report,
      branch,
      tokenUsage: totalTokens,
      pushResult,
    };
    opts.reporter.runComplete(finalReport);
    return finalReport;
  } finally {
    await sandbox.teardown();
  }
}

async function pushAndCreatePR(
  sandbox: Sandbox,
  ctx: RunContext,
  branch: string,
  opts: HarnessOptions,
): Promise<PushResult> {
  const token = opts.githubToken;
  if (!token) {
    return { pushed: false, error: "GITHUB_TOKEN required for push" };
  }

  // Push
  if (sandbox.pushBranch) {
    const pushResult = await sandbox.pushBranch(branch, token);
    if (!pushResult.pushed) {
      return { pushed: false, error: `git push failed: ${pushResult.error}` };
    }
  } else {
    // Local fallback
    const pushExec = await sandbox.exec({
      argv: ["git", "push", "-u", "origin", branch],
      cwd: ctx.workDir,
      timeout: 60_000,
    });
    if (pushExec.exitCode !== 0) {
      return { pushed: false, error: `git push failed: ${pushExec.stderr.trim()}` };
    }
  }

  // Create PR (failure is non-fatal — push already succeeded)
  try {
    const prUrl = await createPR(sandbox, ctx, branch, token, opts);
    return { pushed: true, prUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { pushed: true, error: `PR creation failed: ${msg}` };
  }
}

async function createPR(
  sandbox: Sandbox,
  ctx: RunContext,
  branch: string,
  token: string,
  opts: HarnessOptions,
): Promise<string | undefined> {
  const title = `[harness] ${ctx.intent}`.slice(0, 256);
  const body = `Blueprint: ${opts.blueprint.name}\nBranch: ${branch}\nRun: ${ctx.runId}`;

  // REST API path — used when sandbox knows its default branch (#022)
  if (sandbox.defaultBranch) {
    const { owner, name } = parseGitHubRepo(ctx.repo);
    const base = await sandbox.defaultBranch();

    const resp = await fetch(`https://api.github.com/repos/${owner}/${name}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "pi-harness",
      },
      body: JSON.stringify({ title, body, head: branch, base }),
    });

    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 500);
      throw new Error(`GitHub API ${resp.status}: ${text}`);
    }
    const data: unknown = await resp.json();
    if (typeof data !== "object" || data === null || !("html_url" in data) || typeof (data as Record<string, unknown>)["html_url"] !== "string") {
      throw new Error("GitHub API did not return html_url");
    }
    return (data as { html_url: string }).html_url;
  }

  // Local path: gh CLI
  const prExec = await sandbox.exec({
    argv: ["gh", "pr", "create", "--title", title, "--body", body],
    cwd: ctx.workDir,
    timeout: 30_000,
  });
  if (prExec.exitCode !== 0) {
    throw new Error(prExec.stderr.trim());
  }
  // gh pr create outputs the URL on stdout
  const url = prExec.stdout.trim();
  return url || undefined;
}
