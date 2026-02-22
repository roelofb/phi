import type { ExecOptions, ExecResult } from "../../contracts/types.js";

export interface Sandbox {
  /** Absolute path to the sandbox working directory */
  readonly workDir: string;

  /** Execute a command inside the sandbox */
  exec(opts: ExecOptions): Promise<ExecResult>;

  /** Copy files into the sandbox */
  uploadFiles(files: Array<{ path: string; content: string }>): Promise<void>;

  /** Create a snapshot of the current sandbox state (returns snapshot ID) */
  snapshot(): Promise<string>;

  /** Destroy the sandbox and clean up all resources */
  teardown(): Promise<void>;
}

export interface SandboxOptions {
  /** Source repository path or URL */
  repo: string;
  /** Branch to create for this run */
  branch: string;
  /** Per-operation timeout in ms (default 600_000 = 10min) */
  operationTimeout?: number;
}

/** Default per-operation timeout: 10 minutes */
export const DEFAULT_OPERATION_TIMEOUT = 600_000;

/** Default per-run timeout: 60 minutes */
export const DEFAULT_RUN_TIMEOUT = 3_600_000;
