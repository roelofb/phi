# Product Spec: JSON Reporter

## Purpose

A Reporter implementation that writes structured JSONL (one JSON object per line) to a file. Used for machine-readable run logs, post-run analysis, and audit trails. Library-only — no CLI wiring in this phase.

## Interface

```typescript
import type { Reporter } from "../../src/reporter/types.js";

/**
 * Create a JSON reporter that appends JSONL events to filePath.
 * Redacts secrets and truncates output using existing sanitize utilities.
 */
export function createJsonReporter(
  filePath: string,
  env: Record<string, string>,
): Reporter;
```

The returned object implements the existing `Reporter` interface (no changes needed to `src/reporter/types.ts`):

```typescript
interface Reporter {
  nodeStart(name: string, type: string): void;
  nodeOutput(name: string, chunk: string): void;
  nodeComplete(name: string, result: NodeResult): void;
  runComplete(report: RunReport): void;
}
```

Each method appends one JSONL line to `filePath`.

### Event Schemas

```typescript
// nodeStart
{ timestamp: string; event: "node_start"; name: string; type: string }

// nodeOutput
{ timestamp: string; event: "node_output"; name: string; output: string }

// nodeComplete
{ timestamp: string; event: "node_complete"; name: string; status: NodeStatus; durationMs: number; error?: string }

// runComplete
{ timestamp: string; event: "run_complete"; runId: string; blueprint: string; totalDurationMs: number; tokenUsage: TokenUsage; nodeCount: number }
```

`timestamp` is ISO 8601 format (`new Date().toISOString()`).

## Dependencies

- `src/reporter/types.ts` — `Reporter` interface
- `contracts/types.ts` — `NodeResult`, `RunReport`, `TokenUsage`
- `src/util/sanitize.ts` — `redact()`, `truncate()`, `MAX_OUTPUT_BYTES`
- `node:fs` — `appendFileSync` (synchronous to match void return types)
- `node:path` — `resolve`, `dirname`
- `node:fs/promises` — `stat` (for parent dir validation)

## Behaviour

### Writing events
**Given**: a JSON reporter created with a valid file path
**When**: any reporter method is called
**Then**: one JSON line is appended to the file, terminated by `\n`

### Secret redaction
**Given**: env contains `{ API_KEY: "sk-secret12345" }`
**When**: `nodeOutput("step", "key=sk-secret12345")` is called
**Then**: the output field in the JSONL line contains `[REDACTED:API_KEY]`, not the secret value

### Output truncation
**Given**: a very large output string (>50KB)
**When**: `nodeOutput` is called with it
**Then**: the output field is truncated via `truncate()` before writing

### Run complete summary
**Given**: a completed run
**When**: `runComplete(report)` is called
**Then**: the JSONL line includes `event: "run_complete"`, `tokenUsage` from the report, and `nodeCount` (length of `report.nodes`)

### File path validation
**Given**: a file path where the parent directory does not exist
**When**: `createJsonReporter` is called
**Then**: it throws an error indicating the parent directory must exist

### Path traversal prevention
**Given**: a file path containing `../` sequences
**When**: `createJsonReporter` is called
**Then**: it throws an error (no traversal allowed — resolved path must be under cwd or absolute)

### Error field in nodeComplete
**Given**: a node result with status "failure" and an error message
**When**: `nodeComplete` is called
**Then**: the JSONL line includes the `error` field (redacted)

## Security Constraints

- All output strings must be passed through `redact(output, env)` before writing
- All output strings must be passed through `truncate()` before writing
- File path must be validated: parent directory must exist, no `../` in the path
- Uses synchronous file operations to avoid partial writes on crash

## Acceptance Criteria

1. AC-1: `createJsonReporter` returns an object implementing the `Reporter` interface
2. AC-2: Each reporter method appends exactly one JSONL line to the file
3. AC-3: All lines parse as valid JSON
4. AC-4: Secret values from env are redacted in all output fields
5. AC-5: Output fields are truncated to MAX_OUTPUT_BYTES
6. AC-6: `run_complete` event includes `tokenUsage` with all four fields
7. AC-7: `run_complete` event includes `nodeCount`
8. AC-8: File path validation rejects missing parent directories
9. AC-9: All events include ISO 8601 timestamps
10. AC-10: `nodeComplete` with error includes `error` field in JSON

## Test Scenarios

### Scenario 1: Basic event writing
**Input**: Create reporter, call `nodeStart("step1", "deterministic")`
**Expected**: File contains one line, parses as JSON with `event: "node_start"`, `name: "step1"`, `type: "deterministic"`

### Scenario 2: Multiple events
**Input**: Call nodeStart, nodeOutput, nodeComplete in sequence
**Expected**: File contains exactly 3 lines, each valid JSON

### Scenario 3: Secret redaction
**Input**: env = `{ MY_TOKEN: "longvalue123" }`, call `nodeOutput("x", "found longvalue123")`
**Expected**: JSON output field contains `[REDACTED:MY_TOKEN]`, not `longvalue123`

### Scenario 4: Run complete with tokens
**Input**: Call `runComplete` with report containing `tokenUsage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 }`
**Expected**: JSON line has `tokenUsage` matching those values and `nodeCount` matching `report.nodes.length`

### Scenario 5: Invalid parent directory
**Input**: `createJsonReporter("/nonexistent/path/report.jsonl", {})`
**Expected**: Throws error about parent directory

### Scenario 6: Truncation
**Input**: Call `nodeOutput` with 100KB string
**Expected**: Output field in JSON is truncated and contains `[truncated]`

Files to generate: `src/reporter/json.ts`, `tests/json-reporter.test.ts`
