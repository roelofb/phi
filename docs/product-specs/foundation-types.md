# Product Spec: Foundation Types

## Purpose

Shared boundary types and utility functions that all harness components depend on. Defines the contracts for execution context, node results, run reports, subprocess options, and security/sanitisation helpers. Written first because every other spec references these types.

## Interface

```typescript
// contracts/types.ts

/** Unique run identifier — 8-char hex string */
export type RunId = string;

/** Status of a node execution */
export type NodeStatus = "success" | "failure" | "skipped";

/** Execution context threaded through every node */
export interface RunContext {
  runId: RunId;
  workDir: string;
  intent: string;
  repo: string;
  push: boolean;
  env: Record<string, string>;
  /** Accumulated results from previous nodes, keyed by node name */
  results: Record<string, NodeResult>;
}

/** Outcome of a single node execution */
export interface NodeResult {
  status: NodeStatus;
  output: string;
  durationMs: number;
  error?: string;
}

/** Token usage from an agent invocation */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Full report for a harness run */
export interface RunReport {
  runId: RunId;
  blueprint: string;
  repo: string;
  intent: string;
  nodes: Array<{ name: string } & NodeResult>;
  totalDurationMs: number;
  tokenUsage: TokenUsage;
  push: boolean;
  branch?: string;
}

/** Options for spawning a subprocess */
export interface ExecOptions {
  /** Command as argv array — NO shell strings */
  argv: string[];
  cwd: string;
  timeout: number;
  env?: Record<string, string>;
  /** Max output bytes to capture (default 50KB) */
  maxOutput?: number;
}

/** Result of a subprocess execution */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

// src/util/sanitize.ts

/** Slugify a string for use in branch names, file paths, etc. */
export function slugify(input: string): string;

/**
 * Redact secrets from output.
 * Redacts by name pattern (*KEY, *TOKEN, *SECRET, *PASSWORD, *CREDENTIAL)
 * and by value (any env value ≥8 chars).
 */
export function redact(output: string, env: Record<string, string>): string;

/** Truncate output to maxBytes, appending "[truncated]" if exceeded */
export function truncate(output: string, maxBytes: number): string;

/** Secret name patterns that trigger redaction */
export const SECRET_PATTERNS: RegExp[];

/** Default output cap in bytes */
export const MAX_OUTPUT_BYTES: number; // 50 * 1024

// src/util/preflight.ts

/** Generate an 8-char hex run ID */
export function generateRunId(): string;

/** Validate a repo string (must be a local path or org/repo) */
export function validateRepo(repo: string): void;

/** Validate that a directory exists and is a git repo */
export function validateGitRepo(dir: string): Promise<void>;
```

## Dependencies

- No external dependencies (Node.js built-ins only: `crypto`, `fs`, `path`)
- No imports from other harness components

## Behaviour

### Slugify

**Given**: an arbitrary user-provided string
**When**: `slugify()` is called
**Then**: returns a lowercase alphanumeric string with hyphens, max 64 chars, no leading/trailing hyphens, no consecutive hyphens

### Redact by name

**Given**: output containing `MY_API_KEY=sk-abc123def456` and env has key `MY_API_KEY`
**When**: `redact()` is called
**Then**: the key name is replaced: output contains `[REDACTED:MY_API_KEY]` instead of the value

### Redact by value

**Given**: output containing a literal env value that is ≥8 chars
**When**: `redact()` is called with that env
**Then**: the value is replaced with `[REDACTED]`

### Redact ignores short values

**Given**: output containing a literal env value that is <8 chars
**When**: `redact()` is called
**Then**: the short value is NOT redacted (too many false positives)

### Truncate within limit

**Given**: output within the byte limit
**When**: `truncate()` is called
**Then**: output is returned unchanged

### Truncate exceeding limit

**Given**: output exceeding the byte limit
**When**: `truncate()` is called
**Then**: output is cut to maxBytes and `\n[truncated]` is appended

### Generate run ID

**Given**: no preconditions
**When**: `generateRunId()` is called
**Then**: returns an 8-char lowercase hex string

### Validate repo — local path

**Given**: a valid local directory path
**When**: `validateRepo()` is called
**Then**: no error is thrown

### Validate repo — org/repo

**Given**: a string matching `owner/repo` pattern
**When**: `validateRepo()` is called
**Then**: no error is thrown

### Validate repo — invalid

**Given**: a string that is neither a path nor org/repo (e.g. contains spaces, special chars)
**When**: `validateRepo()` is called
**Then**: throws an error with descriptive message

### Validate git repo — valid

**Given**: a directory that contains a `.git` directory
**When**: `validateGitRepo()` is called
**Then**: resolves without error

### Validate git repo — not a git repo

**Given**: a directory without `.git`
**When**: `validateGitRepo()` is called
**Then**: rejects with descriptive error

## Security Constraints

- `slugify()` must strip all characters except `[a-z0-9-]` to prevent path traversal and command injection
- `redact()` must handle overlapping patterns (longer match wins)
- `redact()` must be called on ALL output before it reaches the reporter
- `SECRET_PATTERNS` must match: KEY, TOKEN, SECRET, PASSWORD, CREDENTIAL (case-insensitive suffix match)
- `truncate()` prevents memory exhaustion from runaway agent output

## Acceptance Criteria

1. AC-1: `slugify("Hello World!! 123")` returns `"hello-world-123"`
2. AC-2: `slugify("")` returns `""` (empty input → empty output)
3. AC-3: `slugify("---abc---")` returns `"abc"` (no leading/trailing hyphens)
4. AC-4: `redact("key=sk-abcdef123456", { API_KEY: "sk-abcdef123456" })` replaces value with `[REDACTED]`
5. AC-5: `redact("short=ab", { X: "ab" })` does NOT redact (value <8 chars)
6. AC-6: `redact()` handles env vars whose names match SECRET_PATTERNS by redacting `[REDACTED:<NAME>]`
7. AC-7: `truncate("hello", 1024)` returns `"hello"` unchanged
8. AC-8: `truncate("x".repeat(100), 50)` returns 50-byte prefix + `\n[truncated]`
9. AC-9: `generateRunId()` returns an 8-char hex string matching `/^[0-9a-f]{8}$/`
10. AC-10: `validateRepo("./local-path")` does not throw
11. AC-11: `validateRepo("org/repo")` does not throw
12. AC-12: `validateRepo("not valid!")` throws
13. AC-13: All types (`RunContext`, `NodeResult`, `RunReport`, `ExecOptions`, `ExecResult`, `TokenUsage`) are exported and compile without error
14. AC-14: `validateGitRepo()` rejects for non-git directory

## Test Scenarios

```typescript
// tests/sanitize.test.ts

test("slugify: normal string", () => {
  expect(slugify("Hello World!! 123")).toBe("hello-world-123");
});

test("slugify: empty string", () => {
  expect(slugify("")).toBe("");
});

test("slugify: strips leading/trailing hyphens", () => {
  expect(slugify("---abc---")).toBe("abc");
});

test("slugify: max 64 chars", () => {
  expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(64);
});

test("redact: by value (≥8 chars)", () => {
  const env = { API_KEY: "sk-abcdef123456" };
  expect(redact("key=sk-abcdef123456", env)).not.toContain("sk-abcdef123456");
});

test("redact: skips short values (<8 chars)", () => {
  const env = { X: "ab" };
  expect(redact("val=ab", { X: "ab" })).toContain("ab");
});

test("redact: by name pattern", () => {
  const env = { MY_SECRET_TOKEN: "longvalue123" };
  const result = redact("found longvalue123 here", env);
  expect(result).toContain("[REDACTED:MY_SECRET_TOKEN]");
});

test("truncate: within limit", () => {
  expect(truncate("hello", 1024)).toBe("hello");
});

test("truncate: exceeds limit", () => {
  const result = truncate("x".repeat(100), 50);
  expect(result).toContain("[truncated]");
  expect(Buffer.byteLength(result.split("\n[truncated]")[0]!)).toBeLessThanOrEqual(50);
});

test("generateRunId: format", () => {
  expect(generateRunId()).toMatch(/^[0-9a-f]{8}$/);
});

test("generateRunId: unique", () => {
  const a = generateRunId();
  const b = generateRunId();
  expect(a).not.toBe(b);
});

test("validateRepo: local path", () => {
  expect(() => validateRepo("./foo")).not.toThrow();
});

test("validateRepo: org/repo", () => {
  expect(() => validateRepo("stripe/stripe-node")).not.toThrow();
});

test("validateRepo: invalid", () => {
  expect(() => validateRepo("not valid!")).toThrow();
});
```

## Files to Generate

- `contracts/types.ts` — All shared types
- `src/util/sanitize.ts` — `slugify()`, `redact()`, `truncate()`, `SECRET_PATTERNS`, `MAX_OUTPUT_BYTES`
- `src/util/preflight.ts` — `generateRunId()`, `validateRepo()`, `validateGitRepo()`
- `tests/sanitize.test.ts` — All test scenarios above
