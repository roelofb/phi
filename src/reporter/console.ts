import type { NodeResult, RunReport } from "../../contracts/types.js";
import type { Reporter } from "./types.js";
import { redact, truncate, MAX_OUTPUT_BYTES } from "../util/sanitize.js";

export function createConsoleReporter(
  env: Record<string, string>,
): Reporter {
  function sanitize(text: string): string {
    return truncate(redact(text, env), MAX_OUTPUT_BYTES);
  }

  return {
    nodeStart(name: string, type: string): void {
      process.stderr.write(`\n[${type}] ${name} ...\n`);
    },

    nodeOutput(name: string, chunk: string): void {
      const clean = sanitize(chunk);
      process.stderr.write(`  [${name}] ${clean}\n`);
    },

    nodeComplete(name: string, result: NodeResult): void {
      const icon = result.status === "success" ? "+" : result.status === "skipped" ? "-" : "x";
      const duration = `${result.durationMs}ms`;
      process.stderr.write(`[${icon}] ${name} (${result.status}, ${duration})\n`);
      if (result.error) {
        process.stderr.write(`    error: ${sanitize(result.error)}\n`);
      }
    },

    runComplete(report: RunReport): void {
      process.stderr.write("\n--- Run Summary ---\n");
      process.stderr.write(`Run ID:    ${report.runId}\n`);
      process.stderr.write(`Blueprint: ${report.blueprint}\n`);
      process.stderr.write(`Repo:      ${report.repo}\n`);
      process.stderr.write(`Duration:  ${report.totalDurationMs}ms\n`);
      process.stderr.write(`Tokens:    ${report.tokenUsage.inputTokens}in / ${report.tokenUsage.outputTokens}out\n`);
      if (report.branch) {
        process.stderr.write(`Branch:    ${report.branch}\n`);
      }
      process.stderr.write("\nNodes:\n");
      for (const node of report.nodes) {
        const icon = node.status === "success" ? "+" : node.status === "skipped" ? "-" : "x";
        process.stderr.write(`  [${icon}] ${node.name}: ${node.status} (${node.durationMs}ms)\n`);
      }
      process.stderr.write("---\n");
    },
  };
}
