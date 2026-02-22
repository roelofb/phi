# Product Spec: Agent Drivers

## Purpose

Agent drivers bridge the harness to external AI agents. Each driver implements the `AgentDriver` interface and handles the specifics of invoking a particular agent (Claude Code, Pi) inside a sandbox. The reporter module handles streaming output to the console with secret redaction.

## Interface

```typescript
// src/agents/types.ts

import type { NodeResult, TokenUsage } from "../../contracts/types.js";
import type { Sandbox } from "../sandbox/types.js";

export interface AgentResult extends NodeResult {
  tokenUsage: TokenUsage;
  /** Session ID for multi-turn (Claude Code --resume) */
  sessionId?: string;
}

export interface AgentOptions {
  /** System prompt appended to agent context */
  systemPrompt?: string;
  /** Additional tools to allow beyond base set */
  allowedTools?: string[];
  /** Resume a previous session */
  sessionId?: string;
  /** Per-invocation timeout in ms (default 600_000) */
  timeout?: number;
}

export interface AgentDriver {
  readonly name: string;
  execute(sandbox: Sandbox, prompt: string, options?: AgentOptions): Promise<AgentResult>;
}

// src/agents/claude-code.ts

export function createClaudeCodeDriver(): AgentDriver;

/**
 * Base tool allowlist for Claude Code.
 * Blueprints extend this, never bypass it.
 */
export const BASE_ALLOWED_TOOLS: string[];

// src/agents/pi.ts

export function createPiDriver(): AgentDriver;

// src/reporter/types.ts

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

// src/reporter/console.ts

import type { RunReport } from "../../contracts/types.js";

export function createConsoleReporter(env: Record<string, string>): Reporter;
```

## Dependencies

- Foundation Types (`contracts/types.ts`) — `NodeResult`, `TokenUsage`, `RunReport`
- Sandbox Manager (`src/sandbox/types.ts`) — `Sandbox`
- Sanitize utilities (`src/util/sanitize.ts`) — `redact()`, `truncate()`, `MAX_OUTPUT_BYTES`
- Node.js built-ins: `child_process`

## Behaviour

### Claude Code driver — basic invocation

**Given**: a sandbox and a prompt
**When**: `execute()` is called on the Claude Code driver
**Then**: runs `claude -p --output-format json` with the prompt via `sandbox.exec()`, parses JSON output, returns `AgentResult` with token usage

### Claude Code driver — allowed tools

**Given**: `AgentOptions` with additional `allowedTools`
**When**: `execute()` is called
**Then**: the `--allowedTools` flag includes `BASE_ALLOWED_TOOLS` merged with the additional tools

### Claude Code driver — system prompt

**Given**: `AgentOptions` with `systemPrompt`
**When**: `execute()` is called
**Then**: the `--append-system-prompt` flag is passed with the prompt

### Claude Code driver — session resume

**Given**: `AgentOptions` with `sessionId`
**When**: `execute()` is called
**Then**: the `--resume` flag is passed with the session ID

### Claude Code driver — timeout

**Given**: a command that exceeds the timeout
**When**: `execute()` is called
**Then**: the process is killed, returns failure result with `timedOut` info

### Claude Code driver — non-zero exit

**Given**: claude exits with non-zero code
**When**: `execute()` is called
**Then**: returns failure result with stderr as error

### Pi driver — basic invocation

**Given**: a sandbox and a prompt
**When**: `execute()` is called on the Pi driver
**Then**: runs `pi --print` with the prompt via `sandbox.exec()`, returns `AgentResult`

### Pi driver — skills injection

**Given**: a sandbox with `.pi/skills/` directory
**When**: `execute()` is called
**Then**: Pi reads skills from the sandbox's `.pi/skills/` directory (handled by Pi itself — we just ensure the directory is available)

### Console reporter — redaction

**Given**: a reporter created with env containing secrets
**When**: `nodeOutput()` is called with output containing a secret value
**Then**: the output is redacted before display

### Console reporter — truncation

**Given**: output exceeding `MAX_OUTPUT_BYTES`
**When**: `nodeOutput()` is called
**Then**: output is truncated

### Console reporter — node lifecycle

**Given**: a reporter
**When**: `nodeStart()` then `nodeComplete()` are called
**Then**: appropriate formatted output is written to stderr

### Console reporter — run complete

**Given**: a reporter
**When**: `runComplete()` is called with a report
**Then**: a summary is written showing total duration, node statuses, and token usage

## Security Constraints

- `BASE_ALLOWED_TOOLS` must be restrictive: `Read`, `Edit`, `Write`, `Bash(pnpm *)`, `Bash(git diff *)`, `Bash(git status *)`, `Glob`, `Grep`
- Agent output must be redacted before logging (both by name pattern and by value)
- Output must be capped at `MAX_OUTPUT_BYTES` (50KB)
- Secrets with ≥8 chars are redacted by value; secret-named env vars are redacted by name with `[REDACTED:<NAME>]`

## Acceptance Criteria

1. AC-1: Claude Code driver builds correct argv with `-p`, `--output-format json`
2. AC-2: Claude Code driver merges `BASE_ALLOWED_TOOLS` with per-invocation tools
3. AC-3: Claude Code driver passes `--append-system-prompt` when systemPrompt is provided
4. AC-4: Claude Code driver passes `--resume` when sessionId is provided
5. AC-5: Claude Code driver returns failure on non-zero exit
6. AC-6: Pi driver builds correct argv with `--print`
7. AC-7: Console reporter redacts secrets by name pattern
8. AC-8: Console reporter redacts secrets by value (≥8 chars)
9. AC-9: Console reporter truncates output exceeding MAX_OUTPUT_BYTES
10. AC-10: Console reporter formats node lifecycle (start → output → complete)
11. AC-11: Console reporter formats run summary on completion
12. AC-12: `BASE_ALLOWED_TOOLS` contains exactly the base set (no wildcards beyond pnpm/git)

## Test Scenarios

```typescript
// tests/agent-drivers.test.ts

import { createClaudeCodeDriver, BASE_ALLOWED_TOOLS } from "../src/agents/claude-code.js";
import { createPiDriver } from "../src/agents/pi.js";
import { createConsoleReporter } from "../src/reporter/console.js";
import type { Sandbox } from "../src/sandbox/types.js";
import type { ExecOptions, ExecResult } from "../contracts/types.js";

function mockSandbox(execFn?: (opts: ExecOptions) => Promise<ExecResult>): Sandbox {
  return {
    workDir: "/tmp/test",
    exec: execFn ?? (async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        result: "done",
        usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0 },
        session_id: "sess-1",
      }),
      stderr: "",
      durationMs: 1000,
      timedOut: false,
    })),
    uploadFiles: async () => {},
    snapshot: async () => "snap",
    teardown: async () => {},
  };
}

test("claude-code driver builds correct argv", async () => {
  let capturedArgv: string[] = [];
  const sandbox = mockSandbox(async (opts) => {
    capturedArgv = opts.argv;
    return {
      exitCode: 0,
      stdout: JSON.stringify({ result: "ok", usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } }),
      stderr: "",
      durationMs: 100,
      timedOut: false,
    };
  });
  const driver = createClaudeCodeDriver();
  await driver.execute(sandbox, "do something");
  expect(capturedArgv).toContain("claude");
  expect(capturedArgv).toContain("-p");
  expect(capturedArgv).toContain("--output-format");
  expect(capturedArgv).toContain("json");
});

test("claude-code driver merges allowed tools", async () => {
  let capturedArgv: string[] = [];
  const sandbox = mockSandbox(async (opts) => {
    capturedArgv = opts.argv;
    return {
      exitCode: 0,
      stdout: JSON.stringify({ result: "ok", usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } }),
      stderr: "",
      durationMs: 100,
      timedOut: false,
    };
  });
  const driver = createClaudeCodeDriver();
  await driver.execute(sandbox, "do something", { allowedTools: ["WebSearch"] });
  const toolsIdx = capturedArgv.indexOf("--allowedTools");
  expect(toolsIdx).toBeGreaterThan(-1);
});

test("claude-code driver handles non-zero exit", async () => {
  const sandbox = mockSandbox(async () => ({
    exitCode: 1,
    stdout: "",
    stderr: "error occurred",
    durationMs: 100,
    timedOut: false,
  }));
  const driver = createClaudeCodeDriver();
  const result = await driver.execute(sandbox, "do something");
  expect(result.status).toBe("failure");
  expect(result.error).toContain("error occurred");
});

test("pi driver builds correct argv", async () => {
  let capturedArgv: string[] = [];
  const sandbox = mockSandbox(async (opts) => {
    capturedArgv = opts.argv;
    return { exitCode: 0, stdout: "done", stderr: "", durationMs: 100, timedOut: false };
  });
  const driver = createPiDriver();
  await driver.execute(sandbox, "do something");
  expect(capturedArgv).toContain("pi");
  expect(capturedArgv).toContain("--print");
});

test("BASE_ALLOWED_TOOLS contains base set", () => {
  expect(BASE_ALLOWED_TOOLS).toContain("Read");
  expect(BASE_ALLOWED_TOOLS).toContain("Edit");
  expect(BASE_ALLOWED_TOOLS).toContain("Write");
  expect(BASE_ALLOWED_TOOLS).toContain("Glob");
  expect(BASE_ALLOWED_TOOLS).toContain("Grep");
});

test("console reporter redacts secrets", () => {
  const output: string[] = [];
  const origWrite = process.stderr.write;
  process.stderr.write = ((chunk: string) => { output.push(chunk); return true; }) as typeof process.stderr.write;
  try {
    const reporter = createConsoleReporter({ MY_TOKEN: "supersecretvalue123" });
    reporter.nodeOutput("test", "found supersecretvalue123 in output");
    expect(output.some(o => o.includes("[REDACTED:MY_TOKEN]"))).toBe(true);
    expect(output.every(o => !o.includes("supersecretvalue123"))).toBe(true);
  } finally {
    process.stderr.write = origWrite;
  }
});
```

## Files to Generate

- `src/agents/types.ts` — `AgentDriver`, `AgentResult`, `AgentOptions`
- `src/agents/claude-code.ts` — `createClaudeCodeDriver()`, `BASE_ALLOWED_TOOLS`
- `src/agents/pi.ts` — `createPiDriver()`
- `src/reporter/types.ts` — `Reporter` interface
- `src/reporter/console.ts` — `createConsoleReporter()`
- `tests/agent-drivers.test.ts` — All test scenarios above
