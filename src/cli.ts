#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runHarness } from "./harness.js";
import { createConsoleReporter } from "./reporter/console.js";
import type { Blueprint } from "./blueprint/types.js";

async function loadBlueprint(name: string): Promise<Blueprint> {
  const bpDir = resolve(import.meta.dirname ?? ".", "../blueprints");
  const bpPath = join(bpDir, `${name}.js`);
  const mod = (await import(bpPath)) as Record<string, Blueprint>;
  const bp = mod[Object.keys(mod)[0]!];
  if (!bp) throw new Error(`Blueprint "${name}" not found at ${bpPath}`);
  return bp;
}

async function listBlueprints(): Promise<
  Array<{ name: string; description: string }>
> {
  const bpDir = resolve(import.meta.dirname ?? ".", "../blueprints");
  const files = await readdir(bpDir);
  const results: Array<{ name: string; description: string }> = [];
  for (const file of files) {
    if (!file.endsWith(".js") && !file.endsWith(".ts")) continue;
    const name = file.replace(/\.(js|ts)$/, "");
    try {
      const bp = await loadBlueprint(name);
      results.push({ name: bp.name, description: bp.description });
    } catch {
      results.push({ name, description: "(failed to load)" });
    }
  }
  return results;
}

const run = defineCommand({
  meta: { name: "run", description: "Execute a blueprint" },
  args: {
    blueprint: {
      type: "string",
      required: true,
      description: "Blueprint name",
    },
    repo: {
      type: "string",
      required: true,
      description: "Repository path or org/repo",
    },
    intent: {
      type: "string",
      required: true,
      description: "What to accomplish",
    },
    push: {
      type: "boolean",
      default: false,
      description: "Push branch and create PR",
    },
    sandbox: {
      type: "string",
      default: "local",
      description: "Sandbox type: local or daytona",
    },
    "run-id": {
      type: "string",
      description: "Correlation ID (auto-generated if omitted)",
    },
    spec: {
      type: "string",
      description: "Path to spec file (for self-build)",
    },
  },
  async run({ args }) {
    const bp = await loadBlueprint(args.blueprint);
    const reporter = createConsoleReporter(process.env as Record<string, string>);
    const report = await runHarness({
      blueprint: bp,
      repo: args.repo,
      intent: args.intent,
      push: args.push,
      sandboxType: args.sandbox as "local" | "daytona",
      runId: args["run-id"],
      reporter,
      specPath: args.spec,
    });

    process.exit(
      report.nodes.some((n) => n.status === "failure") ? 1 : 0,
    );
  },
});

const list = defineCommand({
  meta: { name: "list", description: "List available blueprints" },
  async run() {
    const bps = await listBlueprints();
    for (const bp of bps) {
      process.stdout.write(`${bp.name}\t${bp.description}\n`);
    }
  },
});

const dryRun = defineCommand({
  meta: { name: "dry-run", description: "Show what would execute" },
  args: {
    blueprint: {
      type: "string",
      required: true,
      description: "Blueprint name",
    },
    repo: {
      type: "string",
      default: ".",
      description: "Repository path",
    },
    intent: {
      type: "string",
      default: "(dry run)",
      description: "Intent description",
    },
  },
  async run({ args }) {
    const bp = await loadBlueprint(args.blueprint);
    process.stdout.write(`Blueprint: ${bp.name}\n`);
    process.stdout.write(`Description: ${bp.description}\n\n`);
    process.stdout.write("Nodes:\n");
    for (const node of bp.nodes) {
      process.stdout.write(`  [${node.type}] ${node.name}: ${node.description}\n`);
    }
  },
});

const main = defineCommand({
  meta: {
    name: "harness",
    version: "0.1.0",
    description: "Pi Harness Engineering CLI",
  },
  subCommands: { run, list, "dry-run": dryRun },
});

runMain(main);
