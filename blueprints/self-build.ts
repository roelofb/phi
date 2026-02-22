import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  blueprint,
  preflight,
  deterministic,
  agentic,
  validate,
} from "../src/blueprint/dsl.js";
import { assertPathConfined } from "../src/util/path.js";
import { TRUNCATION_MARKER } from "../src/util/sanitize.js";
import type { Blueprint } from "../src/blueprint/types.js";

export const selfBuild: Blueprint = blueprint(
  "self-build",
  "Build a feature from a product spec: read spec → plan → implement → validate → commit",
  [
    preflight("check-tools", "Verify git, pnpm, and spec file", async (ctx, sandbox) => {
      // Validate sandboxType
      if (ctx.sandboxType !== "local") {
        return {
          status: "failure",
          output: "",
          durationMs: 0,
          error: `self-build requires sandboxType "local", got "${ctx.sandboxType}"`,
        };
      }

      // Validate specPath
      if (!ctx.specPath) {
        return {
          status: "failure",
          output: "",
          durationMs: 0,
          error: "specPath is required for self-build blueprint",
        };
      }

      // Path traversal check
      assertPathConfined(resolve(ctx.workDir, ctx.specPath), ctx.workDir);

      // Verify spec file exists in sandbox
      const specCheck = await sandbox.exec({
        argv: ["test", "-f", ctx.specPath],
        cwd: sandbox.workDir,
        timeout: 5_000,
      });
      if (specCheck.exitCode !== 0) {
        return {
          status: "failure",
          output: "",
          durationMs: specCheck.durationMs,
          error: `Spec file not found in sandbox: ${ctx.specPath}`,
        };
      }

      // Verify tools
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
        output: `git: ${git.stdout.trim()}, pnpm: ${pnpm.stdout.trim()}, spec: ${ctx.specPath}`,
        durationMs: specCheck.durationMs + git.durationMs + pnpm.durationMs,
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
      agent: "pi",
      prompt: (ctx) =>
        [
          `Read docs/ARCHITECTURE.md for project invariants and conventions.`,
          `Read the product spec at: ${ctx.specPath}`,
          `Read existing src/ and contracts/ code for interfaces already defined.`,
          `Plan the implementation. List files to create/modify and the approach.`,
          `Do NOT write code yet — only plan.`,
        ].join("\n"),
    }),

    agentic("implement", "Generate code from spec", {
      agent: "pi",
      prompt: (ctx) => {
        const plan = ctx.results["plan"]?.output ?? "";
        return [
          `Read docs/ARCHITECTURE.md for project invariants.`,
          `Read the product spec at: ${ctx.specPath}`,
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
        agent: "pi",
        prompt: (ctx) => {
          const output = ctx.results["validate"]?.output ?? "";
          return [
            `Validation failed. Output:\n${output}`,
            `Read the spec again at: ${ctx.specPath}`,
            `Fix the failures. Run pnpm typecheck && pnpm test to verify.`,
          ].join("\n");
        },
      }),
      maxRetries: 2,
    }),

    deterministic("export-patch", "Export diff to host filesystem", async (ctx, sandbox) => {
      const diff = await sandbox.exec({
        argv: ["git", "diff", "HEAD"],
        cwd: sandbox.workDir,
        timeout: 30_000,
        maxOutput: 10_000_000,
      });

      if (diff.exitCode !== 0) {
        return {
          status: "failure",
          output: diff.stderr,
          durationMs: diff.durationMs,
          error: "git diff failed",
        };
      }

      // Truncation guard: don't write partial patches
      if (diff.stdout.endsWith(TRUNCATION_MARKER)) {
        return {
          status: "failure",
          output: "",
          durationMs: diff.durationMs,
          error: "Diff output was truncated — refusing to write partial patch",
        };
      }

      if (!diff.stdout.trim()) {
        return {
          status: "success",
          output: "No changes to export",
          durationMs: diff.durationMs,
        };
      }

      const patchPath = `${resolve(ctx.repo)}/harness-patch-${ctx.runId}.diff`;
      await writeFile(patchPath, diff.stdout, "utf-8");

      return {
        status: "success",
        output: `Patch exported to: ${patchPath}`,
        durationMs: diff.durationMs,
      };
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
          `feat: implement from spec\n\nSpec: ${ctx.specPath ?? ctx.intent}\nHarness run: ${ctx.runId}`,
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
