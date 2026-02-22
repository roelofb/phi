import type { AgentDriver, AgentResult, AgentOptions } from "./types.js";
import { ZERO_TOKEN_USAGE } from "./types.js";
import type { Sandbox } from "../sandbox/types.js";

const DEFAULT_TIMEOUT = 600_000;
/** Pi streams tool calls to stdout; 50KB default is too small */
const PI_MAX_OUTPUT = 10 * 1024 * 1024; // 10MB

/** Pi only supports this fixed tool set via --tools */
const PI_TOOLS = "read,bash,edit,write,grep,find,ls";

export function createPiDriver(): AgentDriver {
  return {
    name: "pi",

    async execute(
      sandbox: Sandbox,
      prompt: string,
      options?: AgentOptions,
    ): Promise<AgentResult> {
      const argv = ["pi", "--print", "--no-session"];

      // Pi supports a fixed tool set — individual allowedTools values cannot be mapped
      if (options?.allowedTools?.length) {
        argv.push("--tools", PI_TOOLS);
      }

      // System prompt
      if (options?.systemPrompt) {
        argv.push("--append-system-prompt", options.systemPrompt);
      }

      // Add the prompt
      argv.push(prompt);

      const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
      const execResult = await sandbox.exec({
        argv,
        cwd: sandbox.workDir,
        timeout,
        maxOutput: PI_MAX_OUTPUT,
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
        return {
          status: "failure",
          output: execResult.stdout,
          durationMs: execResult.durationMs,
          error: execResult.stderr || `Exit code ${execResult.exitCode}`,
          tokenUsage: ZERO_TOKEN_USAGE,
        };
      }

      return {
        status: "success",
        output: execResult.stdout,
        durationMs: execResult.durationMs,
        tokenUsage: ZERO_TOKEN_USAGE,
      };
    },
  };
}
