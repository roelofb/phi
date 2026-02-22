import { appendFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { NodeResult, NodeStatus, RunReport, TokenUsage } from "../../contracts/types.js";
import type { Reporter } from "./types.js";
import { redact, truncate, MAX_OUTPUT_BYTES } from "../util/sanitize.js";

interface NodeStartEvent {
  event: "node_start";
  name: string;
  type: string;
}

interface NodeOutputEvent {
  event: "node_output";
  name: string;
  output: string;
}

interface NodeCompleteEvent {
  event: "node_complete";
  name: string;
  status: NodeStatus;
  durationMs: number;
  error?: string;
}

interface RunCompleteEvent {
  event: "run_complete";
  runId: string;
  blueprint: string;
  totalDurationMs: number;
  tokenUsage: TokenUsage;
  nodeCount: number;
}

type JsonReporterEventPayload =
  | NodeStartEvent
  | NodeOutputEvent
  | NodeCompleteEvent
  | RunCompleteEvent;

type JsonReporterEvent = JsonReporterEventPayload & {
  timestamp: string;
};

function hasTraversalSegment(inputPath: string): boolean {
  return inputPath.split(/[\\/]+/).some((segment) => segment === "..");
}

function resolveReporterPath(filePath: string): string {
  if (hasTraversalSegment(filePath)) {
    throw new Error(`Invalid reporter path: traversal segments are not allowed: "${filePath}"`);
  }

  const resolvedPath = resolve(filePath);
  if (!isAbsolute(filePath)) {
    const cwd = resolve(process.cwd());
    const rel = relative(cwd, resolvedPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(
        `Invalid reporter path: relative path resolves outside cwd "${cwd}": "${filePath}"`,
      );
    }
  }

  const parentDir = dirname(resolvedPath);
  let parentStats: ReturnType<typeof statSync>;
  try {
    parentStats = statSync(parentDir);
  } catch {
    throw new Error(
      `Invalid reporter path: parent directory does not exist: "${parentDir}"`,
    );
  }

  if (!parentStats.isDirectory()) {
    throw new Error(`Invalid reporter path: parent is not a directory: "${parentDir}"`);
  }

  return resolvedPath;
}

export function createJsonReporter(
  filePath: string,
  env: Record<string, string>,
): Reporter {
  const resolvedPath = resolveReporterPath(filePath);

  function sanitize(text: string): string {
    return truncate(redact(text, env), MAX_OUTPUT_BYTES);
  }

  function append(event: JsonReporterEventPayload): void {
    const payload: JsonReporterEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };
    appendFileSync(resolvedPath, JSON.stringify(payload) + "\n", "utf8");
  }

  return {
    nodeStart(name: string, type: string): void {
      append({
        event: "node_start",
        name,
        type,
      });
    },

    nodeOutput(name: string, chunk: string): void {
      append({
        event: "node_output",
        name,
        output: sanitize(chunk),
      });
    },

    nodeComplete(name: string, result: NodeResult): void {
      const event: Omit<NodeCompleteEvent, "timestamp"> = {
        event: "node_complete",
        name,
        status: result.status,
        durationMs: result.durationMs,
      };

      if (result.error !== undefined) {
        event.error = sanitize(result.error);
      }

      append(event);
    },

    runComplete(report: RunReport): void {
      append({
        event: "run_complete",
        runId: report.runId,
        blueprint: report.blueprint,
        totalDurationMs: report.totalDurationMs,
        tokenUsage: report.tokenUsage,
        nodeCount: report.nodes.length,
      });
    },
  };
}
