import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunReport } from "../contracts/types.js";
import { createJsonReporter } from "../src/reporter/json.js";
import { MAX_OUTPUT_BYTES, TRUNCATION_MARKER } from "../src/util/sanitize.js";

interface BaseEvent {
  timestamp: string;
  event: string;
}

interface NodeOutputEvent extends BaseEvent {
  event: "node_output";
  name: string;
  output: string;
}

interface NodeCompleteEvent extends BaseEvent {
  event: "node_complete";
  name: string;
  status: "success" | "failure" | "skipped";
  durationMs: number;
  error?: string;
}

interface RunCompleteEvent extends BaseEvent {
  event: "run_complete";
  runId: string;
  blueprint: string;
  totalDurationMs: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  nodeCount: number;
}

let testDir: string;

function buildReport(): RunReport {
  return {
    runId: "abcd1234",
    blueprint: "json-test",
    repo: "./repo",
    intent: "test",
    nodes: [
      {
        name: "step1",
        status: "success",
        output: "ok",
        durationMs: 10,
      },
      {
        name: "step2",
        status: "failure",
        output: "bad",
        durationMs: 20,
        error: "boom",
      },
    ],
    totalDurationMs: 42,
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    },
    push: false,
  };
}

async function readEvents(filePath: string): Promise<BaseEvent[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BaseEvent);
}

function expectIsoTimestamp(timestamp: string): void {
  expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
}

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "json-reporter-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("createJsonReporter", () => {
  test("AC-1/2/3: returns reporter and appends one valid JSONL line per method call", async () => {
    const filePath = join(testDir, "events.jsonl");
    const reporter = createJsonReporter(filePath, {});

    expect(typeof reporter.nodeStart).toBe("function");
    expect(typeof reporter.nodeOutput).toBe("function");
    expect(typeof reporter.nodeComplete).toBe("function");
    expect(typeof reporter.runComplete).toBe("function");

    reporter.nodeStart("step1", "deterministic");
    reporter.nodeOutput("step1", "hello");
    reporter.nodeComplete("step1", {
      status: "success",
      output: "done",
      durationMs: 7,
    });
    reporter.runComplete(buildReport());

    const events = await readEvents(filePath);
    expect(events).toHaveLength(4);
    for (const event of events) {
      expect(typeof event.event).toBe("string");
    }
  });

  test("AC-4: redacts secrets in nodeOutput and nodeComplete error", async () => {
    const secret = "sk-secret12345";
    const filePath = join(testDir, "redaction.jsonl");
    const reporter = createJsonReporter(filePath, {
      API_KEY: secret,
    });

    reporter.nodeOutput("step", `key=${secret}`);
    reporter.nodeComplete("step", {
      status: "failure",
      output: "",
      durationMs: 2,
      error: `failed with ${secret}`,
    });

    const events = await readEvents(filePath);
    const outputEvent = events[0] as NodeOutputEvent;
    const completeEvent = events[1] as NodeCompleteEvent;

    expect(outputEvent.output).toContain("[REDACTED:API_KEY]");
    expect(outputEvent.output).not.toContain(secret);
    expect(completeEvent.error).toContain("[REDACTED:API_KEY]");
    expect(completeEvent.error).not.toContain(secret);
  });

  test("AC-5: truncates oversized output and includes truncation marker", async () => {
    const filePath = join(testDir, "truncate.jsonl");
    const reporter = createJsonReporter(filePath, {});
    const huge = "x".repeat(MAX_OUTPUT_BYTES + 4096);

    reporter.nodeOutput("step", huge);

    const events = await readEvents(filePath);
    const outputEvent = events[0] as NodeOutputEvent;
    expect(outputEvent.output).toContain(TRUNCATION_MARKER);
    const prefix = outputEvent.output.split(`\n${TRUNCATION_MARKER}`)[0]!;
    expect(Buffer.byteLength(prefix, "utf8")).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  });

  test("AC-6/7: run_complete includes full tokenUsage and correct nodeCount", async () => {
    const filePath = join(testDir, "run-complete.jsonl");
    const reporter = createJsonReporter(filePath, {});
    const report = buildReport();

    reporter.runComplete(report);

    const events = await readEvents(filePath);
    const runComplete = events[0] as RunCompleteEvent;
    expect(runComplete.event).toBe("run_complete");
    expect(runComplete.tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    });
    expect(runComplete.nodeCount).toBe(report.nodes.length);
  });

  test("AC-8: throws when parent directory does not exist", () => {
    const missingPath = join(testDir, "missing", "events.jsonl");
    expect(() => createJsonReporter(missingPath, {})).toThrow(/parent directory/i);
  });

  test("path traversal segments are rejected", () => {
    expect(() => createJsonReporter("../events.jsonl", {})).toThrow(/traversal/i);
    expect(() => createJsonReporter("..\\events.jsonl", {})).toThrow(/traversal/i);
  });

  test("AC-9: all events include ISO 8601 timestamps", async () => {
    const filePath = join(testDir, "timestamps.jsonl");
    const reporter = createJsonReporter(filePath, {});

    reporter.nodeStart("step", "deterministic");
    reporter.nodeOutput("step", "out");
    reporter.nodeComplete("step", {
      status: "success",
      output: "ok",
      durationMs: 1,
    });
    reporter.runComplete(buildReport());

    const events = await readEvents(filePath);
    expect(events).toHaveLength(4);
    for (const event of events) {
      expectIsoTimestamp(event.timestamp);
    }
  });

  test("AC-10: nodeComplete failure includes error field", async () => {
    const filePath = join(testDir, "node-complete-error.jsonl");
    const reporter = createJsonReporter(filePath, {});

    reporter.nodeComplete("step", {
      status: "failure",
      output: "bad",
      durationMs: 5,
      error: "failure details",
    });

    const events = await readEvents(filePath);
    const completeEvent = events[0] as NodeCompleteEvent;
    expect(completeEvent.event).toBe("node_complete");
    expect(completeEvent.error).toBe("failure details");
  });

  test("factory rejects parent path that is not a directory", async () => {
    const fileAsParent = join(testDir, "not-a-dir");
    await writeFile(fileAsParent, "x", "utf8");
    const filePath = join(fileAsParent, "events.jsonl");

    expect(() => createJsonReporter(filePath, {})).toThrow(/not a directory/i);
  });

  test("relative paths under cwd are accepted", async () => {
    const nested = join(testDir, "nested");
    await mkdir(nested);
    const previousCwd = process.cwd();
    process.chdir(testDir);
    try {
      const reporter = createJsonReporter("nested/events.jsonl", {});
      reporter.nodeStart("step", "deterministic");
      const events = await readEvents(join(nested, "events.jsonl"));
      expect(events).toHaveLength(1);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
