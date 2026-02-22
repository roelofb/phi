import type { AgentDriver, AgentResult, AgentOptions } from "./types.js";
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

      // System prompt
      if (options?.systemPrompt) {
        argv.push("--config", `system_prompt="${options.systemPrompt}"`);
      }

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
          tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      }

      if (execResult.exitCode !== 0) {
        // Codex writes its banner to stderr even on success;
        // strip it to surface only real error lines
        const stderrLines = execResult.stderr
          .split("\n")
          .filter((l) => !l.startsWith("OpenAI Codex") && !l.startsWith("--------") && l.trim() !== "");
        const errorMsg = stderrLines.join("\n") || `Exit code ${execResult.exitCode}`;
        return {
          status: "failure",
          output: execResult.stdout,
          durationMs: execResult.durationMs,
          error: errorMsg,
          tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      }

      const totalTokens = parseTokenCount(execResult.stdout);
      return {
        status: "success",
        output: execResult.stdout,
        durationMs: execResult.durationMs,
        tokenUsage: {
          inputTokens: totalTokens,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
  };
}
