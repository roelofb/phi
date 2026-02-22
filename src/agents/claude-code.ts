import type { AgentDriver, AgentResult, AgentOptions } from "./types.js";
import { ZERO_TOKEN_USAGE } from "./types.js";
import type { Sandbox } from "../sandbox/types.js";
import type { TokenUsage } from "../../contracts/types.js";

/**
 * Base tool allowlist for Claude Code.
 * Blueprints extend this, never bypass it.
 */
export const BASE_ALLOWED_TOOLS: string[] = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash(pnpm *)",
  "Bash(git diff *)",
  "Bash(git status *)",
];

const DEFAULT_TIMEOUT = 600_000;
/** Claude Code with --output-format json can produce large structured output */
const CLAUDE_MAX_OUTPUT = 10 * 1024 * 1024; // 10MB

interface ClaudeJsonOutput {
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
  session_id?: string;
}

function parseClaudeOutput(stdout: string): {
  result: string;
  tokenUsage: TokenUsage;
  sessionId?: string;
} {
  try {
    const parsed = JSON.parse(stdout) as ClaudeJsonOutput;
    return {
      result: parsed.result ?? stdout,
      tokenUsage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
        cacheReadTokens: parsed.usage?.cache_read_tokens ?? 0,
        cacheWriteTokens: parsed.usage?.cache_write_tokens ?? 0,
      },
      sessionId: parsed.session_id,
    };
  } catch {
    return {
      result: stdout,
      tokenUsage: ZERO_TOKEN_USAGE,
    };
  }
}

export function createClaudeCodeDriver(): AgentDriver {
  return {
    name: "claude-code",

    async execute(
      sandbox: Sandbox,
      prompt: string,
      options?: AgentOptions,
    ): Promise<AgentResult> {
      const argv = ["claude", "-p", "--output-format", "json"];

      // Merge allowed tools
      const tools = [...BASE_ALLOWED_TOOLS, ...(options?.allowedTools ?? [])];
      argv.push("--allowedTools", tools.join(","));

      // System prompt
      if (options?.systemPrompt) {
        argv.push("--append-system-prompt", options.systemPrompt);
      }

      // Session resume
      if (options?.sessionId) {
        argv.push("--resume", options.sessionId);
      }

      // Add the prompt
      argv.push(prompt);

      const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
      const execResult = await sandbox.exec({
        argv,
        cwd: sandbox.workDir,
        timeout,
        maxOutput: CLAUDE_MAX_OUTPUT,
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

      const { result, tokenUsage, sessionId } = parseClaudeOutput(
        execResult.stdout,
      );
      return {
        status: "success",
        output: result,
        durationMs: execResult.durationMs,
        tokenUsage,
        sessionId,
      };
    },
  };
}
