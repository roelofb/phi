import { execFile } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { ExecOptions, ExecResult } from "../../contracts/types.js";
import type { Sandbox, SandboxOptions } from "./types.js";
import { MAX_OUTPUT_BYTES, truncate } from "../util/sanitize.js";
import { assertPathConfined } from "../util/path.js";

function execFilePromise(
  argv: string[],
  opts: { cwd: string; timeout: number; env?: Record<string, string>; maxOutput?: number },
): Promise<ExecResult> {
  const [cmd, ...args] = argv;
  if (!cmd) throw new Error("Empty argv");
  const maxOutput = opts.maxOutput ?? MAX_OUTPUT_BYTES;

  return new Promise((res) => {
    const start = performance.now();
    const child = execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout,
        env: opts.env ? { ...process.env, ...opts.env } : undefined,
        maxBuffer: maxOutput,
        shell: false,
      },
      (err, stdout, stderr) => {
        const durationMs = Math.round(performance.now() - start);
        const timedOut = !!(err && "killed" in err && err.killed);
        const exitCode =
          err && "code" in err && typeof err.code === "number"
            ? err.code
            : err
              ? 1
              : 0;
        res({
          exitCode,
          stdout: truncate(stdout, maxOutput),
          stderr: truncate(stderr, maxOutput),
          durationMs,
          timedOut,
        });
      },
    );
    // Close stdin — sandbox commands are non-interactive.
    // Without this, tools like `pi --print` block waiting on stdin.
    child.stdin?.end();
    // Ensure cleanup on timeout
    child.on("error", () => {});
  });
}

export async function createLocalSandbox(
  opts: SandboxOptions,
): Promise<Sandbox> {
  const id = randomBytes(4).toString("hex");
  const workDir = join(tmpdir(), `harness-${id}`);
  await mkdir(workDir, { recursive: true });

  // Create git worktree
  const repoPath = resolve(opts.repo);
  await new Promise<void>((res, rej) => {
    execFile(
      "git",
      ["worktree", "add", "-b", opts.branch, workDir],
      { cwd: repoPath },
      (err) => (err ? rej(err) : res()),
    );
  });

  // Disable commit signing in the worktree (avoids 1Password/gpg agent issues)
  await new Promise<void>((res) => {
    execFile(
      "git",
      ["config", "commit.gpgsign", "false"],
      { cwd: workDir },
      () => res(),
    );
  });

  let tornDown = false;

  const sandbox: Sandbox = {
    workDir,

    async exec(execOpts: ExecOptions): Promise<ExecResult> {
      assertPathConfined(execOpts.cwd, workDir);
      return execFilePromise(execOpts.argv, {
        cwd: execOpts.cwd,
        timeout: execOpts.timeout,
        env: execOpts.env,
        maxOutput: execOpts.maxOutput,
      });
    },

    async uploadFiles(
      files: Array<{ path: string; content: string }>,
    ): Promise<void> {
      for (const f of files) {
        const target = resolve(workDir, f.path);
        assertPathConfined(target, workDir);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, f.content, "utf-8");
      }
    },

    async snapshot(): Promise<string> {
      // Create a commit to snapshot current state
      const snapId = randomBytes(4).toString("hex");
      await execFilePromise(["git", "add", "-A"], {
        cwd: workDir,
        timeout: 30_000,
      });
      await execFilePromise(
        ["git", "commit", "--allow-empty", "-m", `snapshot-${snapId}`],
        { cwd: workDir, timeout: 30_000 },
      );
      return snapId;
    },

    async teardown(): Promise<void> {
      if (tornDown) return;
      tornDown = true;
      try {
        // Remove the worktree
        await new Promise<void>((res) => {
          execFile(
            "git",
            ["worktree", "remove", "--force", workDir],
            { cwd: repoPath },
            () => res(), // Ignore errors — best-effort cleanup
          );
        });
      } catch {
        // Swallow — idempotent
      }
      try {
        await rm(workDir, { recursive: true, force: true });
      } catch {
        // Swallow — directory may already be gone
      }
      try {
        // Clean up the branch
        await new Promise<void>((res) => {
          execFile(
            "git",
            ["branch", "-D", opts.branch],
            { cwd: repoPath },
            () => res(),
          );
        });
      } catch {
        // Best effort
      }
    },
  };

  return sandbox;
}
