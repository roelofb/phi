import type {
  Blueprint,
  PreflightNode,
  DeterministicNode,
  AgenticNode,
  ValidateNode,
  AnyNode,
} from "./types.js";

export function blueprint(
  name: string,
  description: string,
  nodes: AnyNode[],
): Blueprint {
  return { name, description, nodes };
}

export function preflight(
  name: string,
  description: string,
  check: PreflightNode["check"],
): PreflightNode {
  return { name, type: "preflight", description, check };
}

export function deterministic(
  name: string,
  description: string,
  exec: DeterministicNode["exec"],
): DeterministicNode {
  return { name, type: "deterministic", description, exec };
}

export function agentic(
  name: string,
  description: string,
  opts: {
    agent: AgenticNode["agent"];
    prompt: AgenticNode["prompt"];
    allowedTools?: string[];
  },
): AgenticNode {
  return {
    name,
    type: "agentic",
    description,
    agent: opts.agent,
    prompt: opts.prompt,
    allowedTools: opts.allowedTools,
  };
}

export function validate(
  name: string,
  description: string,
  opts: {
    steps: ValidateNode["steps"];
    onFailure: AgenticNode;
    maxRetries?: number;
  },
): ValidateNode {
  return {
    name,
    type: "validate",
    description,
    steps: opts.steps,
    onFailure: opts.onFailure,
    maxRetries: opts.maxRetries,
  };
}
