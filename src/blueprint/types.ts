import type { RunContext, NodeResult } from "../../contracts/types.js";
import type { Sandbox } from "../sandbox/types.js";

/** Node types with different execution semantics */
export type NodeType = "preflight" | "deterministic" | "agentic" | "validate";

/** Base node definition */
export interface BlueprintNode {
  name: string;
  type: NodeType;
  description: string;
  /** Skip this node if condition returns false */
  skip?: (ctx: RunContext) => boolean;
}

/** Preflight: checks prerequisites (auth, git, tools) */
export interface PreflightNode extends BlueprintNode {
  type: "preflight";
  check: (ctx: RunContext, sandbox: Sandbox) => Promise<NodeResult>;
}

/** Deterministic: runs exact commands (lint, test, install) */
export interface DeterministicNode extends BlueprintNode {
  type: "deterministic";
  exec: (ctx: RunContext, sandbox: Sandbox) => Promise<NodeResult>;
}

/** Agentic: invokes an AI agent for judgment calls */
export interface AgenticNode extends BlueprintNode {
  type: "agentic";
  agent: "claude-code" | "pi";
  prompt: (ctx: RunContext) => string;
  /** Additional tools to allow beyond the base set */
  allowedTools?: string[];
}

/** Validate: composite node — run steps, if fail run onFailure agentic, rerun */
export interface ValidateNode extends BlueprintNode {
  type: "validate";
  /** Steps to validate (deterministic commands) */
  steps: Array<{
    name: string;
    exec: (ctx: RunContext, sandbox: Sandbox) => Promise<NodeResult>;
  }>;
  /** Agentic node to run when steps fail */
  onFailure: AgenticNode;
  /** Max retry attempts (default 2) */
  maxRetries?: number;
}

export type AnyNode =
  | PreflightNode
  | DeterministicNode
  | AgenticNode
  | ValidateNode;

/** A blueprint is a named sequence of nodes */
export interface Blueprint {
  name: string;
  description: string;
  nodes: AnyNode[];
}
