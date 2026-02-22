import type { AgentDriver, AgentResult, AgentOptions } from "./types.js";
import { ZERO_TOKEN_USAGE } from "./types.js";
import type { Sandbox } from "../sandbox/types.js";

const DEFAULT_TIMEOUT = 600_000;
/** Codex streams file diffs to stdout; 50KB is far too small */
const CODEX_MAX_OUTPUT = 10 * 1024 * 1024; // 10MB

/** Extract token count from codex stdout "tokens used\nN,NNN" pattern */
function parseTokenCount(stdout: string): number {
  const match = /tokens used\n([\d,]+)/i.exec(stdout);
  if (!match?.[1]) return 0;
  return Number.parseInt(match[1].replace(/,/g, ""), 10) || 0;
}

export function createCodexDriver(): AgentDriver {
  return {
    name: "codex",

    async execute(
      sandbox: Sandbox,
      prompt: string,
      options?: AgentOptions,
    ): Promise<AgentResult> {
      const argv = [
        "codex", "exec",
        "--full-auto",
        "-C", sandbox.workDir,
      ];

      // System prompt — escape embedded double quotes to prevent config injection
      if (options?.systemPrompt) {
        const escaped = options.systemPrompt.replace(/"/g, '\\"');
        argv.push("--config", `system_prompt="${escaped}"`);
      }

      // Codex uses --full-auto which grants all tools;
      // allowedTools cannot be mapped — silently ignored
      // (documented limitation of --full-auto mode)

      // Add the prompt
      argv.push(prompt);

      const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
      const execResult = await sandbox.exec({
        argv,
        cwd: sandbox.workDir,
        timeout,
        maxOutput: CODEX_MAX_OUTPUT,
      });

      if (execResult.timedOut) {
        return {
          status: "failure",
          output: execResult.stdout,
          durationMs: execResult.durationMs,
          error: "Agent timed out",
          tokenUsage: ZERO_TOKEN_USAGE,
        };
      }

      if (execResult.exitCode !== 0) {
        // Only use stderr for error message on non-zero exit;
        // banner noise on success is harmless
        const errorMsg = execResult.stderr.trim() || `Exit code ${execResult.exitCode}`;
        return {
          status: "failure",
          output: execResult.stdout,
          durationMs: execResult.durationMs,
          error: errorMsg,
          tokenUsage: ZERO_TOKEN_USAGE,
        };
      }

      // Codex reports total tokens (not split by input/output)
      const totalTokens = parseTokenCount(execResult.stdout);
      return {
        status: "success",
        output: execResult.stdout,
        durationMs: execResult.durationMs,
        tokenUsage: {
          inputTokens: totalTokens, // total — Codex CLI doesn't split input/output
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
  };
}
