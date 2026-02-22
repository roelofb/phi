import {
  blueprint,
  preflight,
  deterministic,
  agentic,
  validate,
} from "../src/blueprint/dsl.js";
import type { Blueprint } from "../src/blueprint/types.js";

export const bugFix: Blueprint = blueprint(
  "bug-fix",
  "Investigate and fix a bug: clone → install → investigate → implement → validate → commit",
  [
    preflight("check-git", "Verify git and auth are available", async (_ctx, sandbox) => {
      const result = await sandbox.exec({
        argv: ["git", "--version"],
        cwd: sandbox.workDir,
        timeout: 10_000,
      });
      return {
        status: result.exitCode === 0 ? "success" : "failure",
        output: result.stdout,
        durationMs: result.durationMs,
        error: result.exitCode !== 0 ? "git not available" : undefined,
      };
    }),

    deterministic("install", "Install dependencies", async (_ctx, sandbox) => {
      const result = await sandbox.exec({
        argv: ["pnpm", "install", "--frozen-lockfile"],
        cwd: sandbox.workDir,
        timeout: 120_000,
      });
      return {
        status: result.exitCode === 0 ? "success" : "failure",
        output: result.stdout,
        durationMs: result.durationMs,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    }),

    agentic("investigate", "Investigate the bug", {
      agent: "claude-code",
      prompt: (ctx) =>
        `Investigate this bug in the repository at ${ctx.workDir}.\n\nIntent: ${ctx.intent}\n\nRead relevant files, understand the codebase, and identify the root cause. Report your findings.`,
    }),

    agentic("implement", "Implement the fix", {
      agent: "claude-code",
      prompt: (ctx) => {
        const investigation = ctx.results["investigate"]?.output ?? "";
        return `Based on the investigation:\n\n${investigation}\n\nImplement a fix for the bug. Make minimal, targeted changes. Do not refactor unrelated code.`;
      },
    }),

    validate("validate", "Run lint and tests to verify the fix", {
      steps: [
        {
          name: "typecheck",
          exec: async (_ctx, sandbox) => {
            const result = await sandbox.exec({
              argv: ["pnpm", "typecheck"],
              cwd: sandbox.workDir,
              timeout: 60_000,
            });
            return {
              status: result.exitCode === 0 ? "success" : "failure",
              output: result.stdout + result.stderr,
              durationMs: result.durationMs,
              error: result.exitCode !== 0 ? "Typecheck failed" : undefined,
            };
          },
        },
        {
          name: "test",
          exec: async (_ctx, sandbox) => {
            const result = await sandbox.exec({
              argv: ["pnpm", "test"],
              cwd: sandbox.workDir,
              timeout: 120_000,
            });
            return {
              status: result.exitCode === 0 ? "success" : "failure",
              output: result.stdout + result.stderr,
              durationMs: result.durationMs,
              error: result.exitCode !== 0 ? "Tests failed" : undefined,
            };
          },
        },
      ],
      onFailure: agentic("fix-failures", "Fix test/lint failures", {
        agent: "claude-code",
        prompt: (ctx) => {
          const validateResult = ctx.results["validate"]?.output ?? "";
          return `The validation step failed:\n\n${validateResult}\n\nFix the failures. Run the failing commands to verify your fixes.`;
        },
      }),
      maxRetries: 2,
    }),

    deterministic("commit", "Commit the fix", async (ctx, sandbox) => {
      await sandbox.exec({
        argv: ["git", "add", "-A"],
        cwd: sandbox.workDir,
        timeout: 10_000,
      });
      const result = await sandbox.exec({
        argv: [
          "git",
          "commit",
          "-m",
          `fix: ${ctx.intent}\n\nHarness run: ${ctx.runId}`,
        ],
        cwd: sandbox.workDir,
        timeout: 10_000,
      });
      return {
        status: result.exitCode === 0 ? "success" : "failure",
        output: result.stdout,
        durationMs: result.durationMs,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    }),
  ],
);
