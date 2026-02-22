import type { NodeResult, RunReport } from "../../contracts/types.js";

export interface Reporter {
  /** Called when a node starts */
  nodeStart(name: string, type: string): void;
  /** Called when a node produces output */
  nodeOutput(name: string, chunk: string): void;
  /** Called when a node completes */
  nodeComplete(name: string, result: NodeResult): void;
  /** Called when the full run completes */
  runComplete(report: RunReport): void;
}
