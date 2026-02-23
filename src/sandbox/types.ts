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

  /** Push the current branch to remote. Optional — undefined if not supported. */
  pushBranch?(branch: string, token: string): Promise<{ pushed: boolean; error?: string }>;

  /** Get the default branch name of the remote repo. Optional. */
  defaultBranch?(): Promise<string>;
}

export interface DaytonaOptions {
  /** Daytona API key (default: DAYTONA_API_KEY env var) */
  apiKey?: string;
  /** Daytona API URL (default: https://app.daytona.io/api) */
  apiUrl?: string;
  /** Daytona target region (default: DAYTONA_TARGET env var or "us") */
  target?: string;
  /** Snapshot name (default: "daytona-medium") */
  snapshot?: string;
}

export interface SandboxOptions {
  /** Source repository path or URL */
  repo: string;
  /** Branch to create for this run */
  branch: string;
  /** Daytona-specific options (ignored by LocalSandbox) */
  daytona?: DaytonaOptions;
  /** GitHub PAT for clone/push (read from GITHUB_TOKEN env var if not set) */
  githubToken?: string;
}
