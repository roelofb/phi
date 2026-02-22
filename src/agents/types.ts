import type { NodeResult, TokenUsage } from "../../contracts/types.js";
import type { Sandbox } from "../sandbox/types.js";

/** Zero-valued token usage — shared across all driver error/timeout paths */
export const ZERO_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export interface AgentResult extends NodeResult {
  tokenUsage: TokenUsage;
  /** Session ID for multi-turn (Claude Code --resume) */
  sessionId?: string;
}

export interface AgentOptions {
  /** System prompt appended to agent context */
  systemPrompt?: string;
  /** Additional tools to allow beyond base set */
  allowedTools?: string[];
  /** Resume a previous session */
  sessionId?: string;
  /** Per-invocation timeout in ms (default 600_000) */
  timeout?: number;
}

export interface AgentDriver {
  readonly name: string;
  execute(
    sandbox: Sandbox,
    prompt: string,
    options?: AgentOptions,
  ): Promise<AgentResult>;
}
