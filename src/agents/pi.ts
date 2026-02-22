import type { AgentDriver, AgentResult, AgentOptions } from "./types.js";
import type { Sandbox } from "../sandbox/types.js";

const DEFAULT_TIMEOUT = 600_000;

export function createPiDriver(): AgentDriver {
  return {
    name: "pi",

    async execute(
      sandbox: Sandbox,
      prompt: string,
      options?: AgentOptions,
    ): Promise<AgentResult> {
      const argv = ["pi", "--print", prompt];
      const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

      const execResult = await sandbox.exec({
        argv,
        cwd: sandbox.workDir,
        timeout,
      });

      if (execResult.timedOut) {
        return {
          status: "failure",
          output: execResult.stdout,
          durationMs: execResult.durationMs,
          error: "Agent timed out",
          tokenUsage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        };
      }

      if (execResult.exitCode !== 0) {
        return {
          status: "failure",
          output: execResult.stdout,
          durationMs: execResult.durationMs,
          error: execResult.stderr || `Exit code ${execResult.exitCode}`,
          tokenUsage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        };
      }

      return {
        status: "success",
        output: execResult.stdout,
        durationMs: execResult.durationMs,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
  };
}
