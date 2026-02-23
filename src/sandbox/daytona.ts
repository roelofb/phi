import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { Daytona } from "@daytonaio/sdk";
import type { ExecOptions, ExecResult } from "../../contracts/types.js";
import type { Sandbox, SandboxOptions } from "./types.js";
import { MAX_OUTPUT_BYTES, truncate } from "../util/sanitize.js";
import { assertPathConfined } from "../util/path.js";
import { shellQuote } from "../util/shell.js";
import { parseGitHubRepo } from "../util/github.js";

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CLONE_BASE = "/home/daytona/workspace";

export async function createDaytonaSandbox(
  opts: SandboxOptions,
): Promise<Sandbox> {
  // Validate
  const apiKey = opts.daytona?.apiKey ?? process.env["DAYTONA_API_KEY"];
  if (!apiKey) {
    throw new Error("Daytona API key required (set DAYTONA_API_KEY or pass opts.daytona.apiKey)");
  }

  const { owner, name } = parseGitHubRepo(opts.repo);
  const cloneUrl = `https://github.com/${owner}/${name}.git`;
  const workDir = `${CLONE_BASE}/${name}`;
  const githubToken = opts.githubToken ?? process.env["GITHUB_TOKEN"];

  // Init SDK
  const daytona = new Daytona({
    apiKey,
    apiUrl: opts.daytona?.apiUrl ?? process.env["DAYTONA_API_URL"],
    target: opts.daytona?.target ?? process.env["DAYTONA_TARGET"],
  });

  // Create sandbox
  const dSandbox = await daytona.create({
    snapshot: opts.daytona?.snapshot ?? "daytona-medium",
    autoStopInterval: 30,
    autoDeleteInterval: 0,
  });

  // Bootstrap — delete sandbox on failure
  try {
    await dSandbox.git.clone(
      cloneUrl, workDir, undefined, undefined, "git", githubToken,
    );
    await dSandbox.git.createBranch(workDir, opts.branch);
    await dSandbox.git.checkoutBranch(workDir, opts.branch);
  } catch (err) {
    await daytona.delete(dSandbox).catch(() => {});
    throw err;
  }

  // Persistent session — reused across all exec calls (#017)
  const sessionId = `harness-${randomBytes(4).toString("hex")}`;
  await dSandbox.process.createSession(sessionId);

  // Instance state
  let tornDown = false;
  let cachedDefaultBranch: string | undefined;

  const sandbox: Sandbox = {
    workDir,

    async exec(execOpts: ExecOptions): Promise<ExecResult> {
      assertPathConfined(execOpts.cwd, workDir);

      // Validate env keys
      if (execOpts.env) {
        for (const key of Object.keys(execOpts.env)) {
          if (!ENV_KEY_RE.test(key)) {
            throw new Error(`Invalid env key "${key}" — must match [A-Za-z_][A-Za-z0-9_]*`);
          }
        }
      }

      const maxOutput = execOpts.maxOutput ?? MAX_OUTPUT_BYTES;
      const timeoutSec = Math.ceil(execOpts.timeout / 1000);

      // Build command
      const cdPrefix = `cd ${shellQuote([execOpts.cwd])} &&`;
      const envEntries = Object.entries(execOpts.env ?? {});
      const envPrefix = envEntries.length > 0
        ? envEntries.map(([k, v]) => `${k}=${shellQuote([v])}`).join(" ") + " "
        : "";
      const fullCommand = `${cdPrefix} ${envPrefix}${shellQuote(execOpts.argv)}`;

      const start = performance.now();
      try {
        const cmd = await dSandbox.process.executeSessionCommand(sessionId, {
          command: fullCommand,
          runAsync: false,
        }, timeoutSec);

        const durationMs = Math.round(performance.now() - start);

        return {
          exitCode: cmd.exitCode ?? 1,
          stdout: truncate(cmd.stdout ?? "", maxOutput),
          stderr: truncate(cmd.stderr ?? "", maxOutput),
          durationMs,
          timedOut: false,
        };
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        const isTimeout = err instanceof Error && /timeout/i.test(err.message);
        if (isTimeout) {
          return { exitCode: 124, stdout: "", stderr: "", durationMs, timedOut: true };
        }
        throw err;
      }
    },

    async uploadFiles(files: Array<{ path: string; content: string }>): Promise<void> {
      for (const f of files) {
        const target = resolve(workDir, f.path);
        assertPathConfined(target, workDir);
        const dir = dirname(target);
        await dSandbox.fs.createFolder(dir, "755");
        await dSandbox.fs.uploadFile(Buffer.from(f.content), target);
      }
    },

    async snapshot(): Promise<string> {
      const snapId = randomBytes(4).toString("hex");
      const status = await dSandbox.git.status(workDir);
      if (status.fileStatus && status.fileStatus.length > 0) {
        await dSandbox.git.add(workDir, ["."]);
        await dSandbox.git.commit(workDir, `snapshot-${snapId}`, "harness", "harness@local");
      } else {
        await dSandbox.git.commit(workDir, `snapshot-${snapId}`, "harness", "harness@local", true);
      }
      return snapId;
    },

    async teardown(): Promise<void> {
      if (tornDown) return;
      tornDown = true;
      try {
        await dSandbox.process.deleteSession(sessionId).catch(() => {});
        await daytona.delete(dSandbox);
      } catch {
        // Swallow — idempotent (sandbox may already be deleted)
      }
    },

    async pushBranch(_branch: string, token: string): Promise<{ pushed: boolean; error?: string }> {
      // _branch unused — SDK pushes the currently checked-out branch.
      // The harness branch was checked out during bootstrap.
      try {
        await dSandbox.git.push(workDir, "git", token);
        return { pushed: true };
      } catch (err) {
        return { pushed: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async defaultBranch(): Promise<string> {
      if (cachedDefaultBranch) return cachedDefaultBranch;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "pi-harness",
      };
      if (githubToken) headers["Authorization"] = `Bearer ${githubToken}`;

      const resp = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
      if (!resp.ok) throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
      const data: unknown = await resp.json();
      if (typeof data !== "object" || data === null || !("default_branch" in data) || typeof (data as Record<string, unknown>)["default_branch"] !== "string") {
        throw new Error("GitHub API did not return default_branch");
      }
      cachedDefaultBranch = (data as { default_branch: string }).default_branch;
      return cachedDefaultBranch;
    },
  };

  return sandbox;
}
