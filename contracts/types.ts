/** Unique run identifier — 8-char hex string */
export type RunId = string;

/** Status of a node execution */
export type NodeStatus = "success" | "failure" | "skipped";

/** Execution context threaded through every node */
export interface RunContext {
  runId: RunId;
  workDir: string;
  intent: string;
  repo: string;
  push: boolean;
  env: Record<string, string>;
  /** Accumulated results from previous nodes, keyed by node name */
  results: Record<string, NodeResult>;
  /** Path to product spec file (repo-relative) */
  specPath?: string;
  /** Sandbox implementation in use */
  sandboxType: "local" | "daytona";
}

/** Outcome of a single node execution */
export interface NodeResult {
  status: NodeStatus;
  output: string;
  durationMs: number;
  error?: string;
}

/** Token usage from an agent invocation */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Full report for a harness run */
export interface RunReport {
  runId: RunId;
  blueprint: string;
  repo: string;
  intent: string;
  nodes: Array<{ name: string } & NodeResult>;
  totalDurationMs: number;
  tokenUsage: TokenUsage;
  push: boolean;
  branch?: string;
  pushResult?: PushResult;
}

/** Outcome of the push+PR flow */
export interface PushResult {
  pushed: boolean;
  prUrl?: string;
  error?: string;
}

/** Options for spawning a subprocess */
export interface ExecOptions {
  /** Command as argv array — NO shell strings */
  argv: string[];
  cwd: string;
  timeout: number;
  env?: Record<string, string>;
  /** Max output bytes to capture (default 50KB) */
  maxOutput?: number;
}

/** Result of a subprocess execution */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}
