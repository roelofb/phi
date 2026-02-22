import {
  blueprint,
  preflight,
  deterministic,
  agentic,
  validate,
} from "../src/blueprint/dsl.js";
import type { Blueprint } from "../src/blueprint/types.js";

export const selfBuild: Blueprint = blueprint(
  "self-build",
  "Build a feature from a product spec: read spec → plan → implement → validate → commit",
  [
    preflight("check-tools", "Verify git and pnpm are available", async (_ctx, sandbox) => {
      const git = await sandbox.exec({
        argv: ["git", "--version"],
        cwd: sandbox.workDir,
        timeout: 10_000,
      });
      const pnpm = await sandbox.exec({
        argv: ["pnpm", "--version"],
        cwd: sandbox.workDir,
        timeout: 10_000,
      });
      const ok = git.exitCode === 0 && pnpm.exitCode === 0;
      return {
        status: ok ? "success" : "failure",
        output: `git: ${git.stdout.trim()}, pnpm: ${pnpm.stdout.trim()}`,
        durationMs: git.durationMs + pnpm.durationMs,
        error: ok ? undefined : "Required tools not available",
      };
    }),

    deterministic("install", "Install dependencies", async (_ctx, sandbox) => {
      const result = await sandbox.exec({
        argv: ["pnpm", "install"],
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

    agentic("plan", "Read the spec and plan implementation", {
      agent: "claude-code",
      prompt: (ctx) =>
        [
          `Read docs/ARCHITECTURE.md for project invariants and conventions.`,
          `Read the product spec: ${ctx.intent}`,
          `Read existing src/ and contracts/ code for interfaces already defined.`,
          `Plan the implementation. List files to create/modify and the approach.`,
          `Do NOT write code yet — only plan.`,
        ].join("\n"),
    }),

    agentic("implement", "Generate code from spec", {
      agent: "claude-code",
      prompt: (ctx) => {
        const plan = ctx.results["plan"]?.output ?? "";
        return [
          `Read docs/ARCHITECTURE.md for project invariants.`,
          `Read the product spec: ${ctx.intent}`,
          `Read existing src/ and contracts/ code.`,
          `Based on this plan:\n${plan}`,
          `Generate the implementation and tests according to the spec.`,
          `All acceptance criteria must pass.`,
        ].join("\n");
      },
      allowedTools: ["Bash(pnpm typecheck *)", "Bash(pnpm test *)"],
    }),

    validate("validate", "Run typecheck and tests", {
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
      onFailure: agentic("fix-failures", "Fix validation failures", {
        agent: "claude-code",
        prompt: (ctx) => {
          const output = ctx.results["validate"]?.output ?? "";
          return [
            `Validation failed. Output:\n${output}`,
            `Read the spec again: ${ctx.intent}`,
            `Fix the failures. Run pnpm typecheck && pnpm test to verify.`,
          ].join("\n");
        },
      }),
      maxRetries: 2,
    }),

    deterministic("commit", "Commit the implementation", async (ctx, sandbox) => {
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
          `feat: implement from spec\n\nSpec: ${ctx.intent}\nHarness run: ${ctx.runId}`,
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
