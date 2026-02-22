import { describe, test, expect } from "vitest";
import {
  blueprint,
  preflight,
  deterministic,
  agentic,
  validate,
} from "../src/blueprint/dsl.js";
import { executeBlueprint } from "../src/blueprint/engine.js";
import type { AgentExecutor } from "../src/blueprint/engine.js";
import type { RunContext, NodeResult } from "../contracts/types.js";
import type { Sandbox } from "../src/sandbox/types.js";

function mockSandbox(): Sandbox {
  return {
    workDir: "/tmp/test",
    exec: async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 0,
      timedOut: false,
    }),
    uploadFiles: async () => {},
    snapshot: async () => "snap-1",
    teardown: async () => {},
  };
}

function mockAgent(): AgentExecutor {
  return {
    execute: async () => ({
      status: "success",
      output: "agent done",
      durationMs: 100,
    }),
  };
}

function baseContext(): RunContext {
  return {
    runId: "abcd1234",
    workDir: "/tmp/test",
    intent: "test",
    repo: "./test",
    push: false,
    env: {},
    results: {},
    sandboxType: "local",
  };
}

describe("executeBlueprint", () => {
  test("happy path — all nodes succeed", async () => {
    const bp = blueprint("test", "test blueprint", [
      preflight("check-git", "check git", async () => ({
        status: "success",
        output: "ok",
        durationMs: 1,
      })),
      deterministic("install", "install deps", async () => ({
        status: "success",
        output: "done",
        durationMs: 1,
      })),
    ]);
    const report = await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
    });
    expect(report.nodes).toHaveLength(2);
    expect(report.nodes.every((n) => n.status === "success")).toBe(true);
    expect(report.blueprint).toBe("test");
    expect(report.runId).toBe("abcd1234");
  });

  test("node failure halts execution", async () => {
    const bp = blueprint("test", "test", [
      deterministic("fail", "fails", async () => ({
        status: "failure",
        output: "err",
        durationMs: 1,
        error: "boom",
      })),
      deterministic("never", "never runs", async () => ({
        status: "success",
        output: "ok",
        durationMs: 1,
      })),
    ]);
    const report = await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
    });
    expect(report.nodes).toHaveLength(1);
    expect(report.nodes[0]!.status).toBe("failure");
  });

  test("skip node", async () => {
    const node = deterministic("skippable", "maybe skip", async () => ({
      status: "success",
      output: "ran",
      durationMs: 1,
    }));
    node.skip = () => true;

    const bp = blueprint("test", "test", [
      node,
      deterministic("after", "runs after skip", async () => ({
        status: "success",
        output: "yes",
        durationMs: 1,
      })),
    ]);
    const report = await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
    });
    expect(report.nodes[0]!.status).toBe("skipped");
    expect(report.nodes[1]!.status).toBe("success");
  });

  test("context threading — later nodes see earlier results", async () => {
    let capturedCtx: RunContext | null = null;
    const bp = blueprint("test", "test", [
      deterministic("first", "first", async () => ({
        status: "success",
        output: "hello",
        durationMs: 1,
      })),
      deterministic("second", "second", async (ctx) => {
        capturedCtx = ctx;
        return { status: "success", output: "ok", durationMs: 1 };
      }),
    ]);
    await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
    });
    expect(capturedCtx!.results["first"]!.output).toBe("hello");
  });

  test("onNodeComplete callback", async () => {
    const completed: Array<{ name: string; result: NodeResult }> = [];
    const bp = blueprint("test", "test", [
      deterministic("step1", "first", async () => ({
        status: "success",
        output: "ok",
        durationMs: 1,
      })),
    ]);
    await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
      onNodeComplete: (name, result) => completed.push({ name, result }),
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]!.name).toBe("step1");
    expect(completed[0]!.result.status).toBe("success");
  });

  test("totalDurationMs is populated", async () => {
    const bp = blueprint("test", "test", [
      deterministic("step", "step", async () => ({
        status: "success",
        output: "ok",
        durationMs: 1,
      })),
    ]);
    const report = await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
    });
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  test("agentic node invokes agent executor", async () => {
    let agentCalled = false;
    const bp = blueprint("test", "test", [
      agentic("ai-step", "agentic", {
        agent: "claude-code",
        prompt: () => "do something",
      }),
    ]);
    await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: {
        execute: async () => {
          agentCalled = true;
          return { status: "success", output: "done", durationMs: 50 };
        },
      },
    });
    expect(agentCalled).toBe(true);
  });
});

describe("validate node", () => {
  test("passes on first try — no retry", async () => {
    const bp = blueprint("test", "test", [
      validate("check", "validate", {
        steps: [
          {
            name: "lint",
            exec: async () => ({
              status: "success",
              output: "ok",
              durationMs: 1,
            }),
          },
        ],
        onFailure: agentic("fix", "fix", {
          agent: "claude-code",
          prompt: () => "fix it",
        }),
      }),
    ]);
    const report = await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
    });
    expect(report.nodes[0]!.status).toBe("success");
  });

  test("fails then succeeds on retry", async () => {
    let callCount = 0;
    const bp = blueprint("test", "test", [
      validate("check", "validate", {
        steps: [
          {
            name: "test",
            exec: async () => {
              callCount++;
              if (callCount === 1)
                return {
                  status: "failure",
                  output: "fail",
                  durationMs: 1,
                  error: "bad",
                };
              return { status: "success", output: "ok", durationMs: 1 };
            },
          },
        ],
        onFailure: agentic("fix", "fix", {
          agent: "claude-code",
          prompt: () => "fix it",
        }),
      }),
    ]);
    const report = await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
    });
    expect(report.nodes[0]!.status).toBe("success");
    expect(callCount).toBe(2);
  });

  test("exhausts retries — returns failure", async () => {
    const bp = blueprint("test", "test", [
      validate("check", "validate", {
        steps: [
          {
            name: "test",
            exec: async () => ({
              status: "failure",
              output: "always fails",
              durationMs: 1,
              error: "persistent failure",
            }),
          },
        ],
        onFailure: agentic("fix", "fix", {
          agent: "claude-code",
          prompt: () => "fix it",
        }),
        maxRetries: 1,
      }),
    ]);
    const report = await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
    });
    const checkNode = report.nodes.find((n) => n.name === "check");
    expect(checkNode!.status).toBe("failure");
    // onFailure result also present in report
    const fixNode = report.nodes.find((n) => n.name === "fix");
    expect(fixNode).toBeDefined();
  });
});

describe("onFailure visibility", () => {
  test("onFailure result emitted via onNodeComplete", async () => {
    const completed: Array<{ name: string; status: string }> = [];
    let callCount = 0;
    const bp = blueprint("test", "test", [
      validate("check", "validate", {
        steps: [
          {
            name: "test",
            exec: async () => {
              callCount++;
              if (callCount <= 1) {
                return { status: "failure", output: "fail", durationMs: 1, error: "bad" };
              }
              return { status: "success", output: "ok", durationMs: 1 };
            },
          },
        ],
        onFailure: agentic("fix", "fix", {
          agent: "claude-code",
          prompt: () => "fix it",
        }),
      }),
    ]);
    await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
      onNodeComplete: (name, result) => completed.push({ name, status: result.status }),
    });
    // onFailure "fix" should have been emitted
    expect(completed.some((c) => c.name === "fix")).toBe(true);
    // validate "check" should also be emitted
    expect(completed.some((c) => c.name === "check")).toBe(true);
  });

  test("onFailure result present in RunReport.nodes", async () => {
    let callCount = 0;
    const bp = blueprint("test", "test", [
      validate("check", "validate", {
        steps: [
          {
            name: "test",
            exec: async () => {
              callCount++;
              if (callCount <= 1) {
                return { status: "failure", output: "fail", durationMs: 1, error: "bad" };
              }
              return { status: "success", output: "ok", durationMs: 1 };
            },
          },
        ],
        onFailure: agentic("fix", "fix", {
          agent: "claude-code",
          prompt: () => "fix it",
        }),
      }),
    ]);
    const report = await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
    });
    // Both "fix" (onFailure) and "check" (validate) should be in nodes
    expect(report.nodes.some((n) => n.name === "fix")).toBe(true);
    expect(report.nodes.some((n) => n.name === "check")).toBe(true);
  });

  test("onNodeStart fires before onFailure execution", async () => {
    const events: Array<{ type: "start" | "complete"; name: string }> = [];
    let callCount = 0;
    const bp = blueprint("test", "test", [
      validate("check", "validate", {
        steps: [
          {
            name: "test",
            exec: async () => {
              callCount++;
              if (callCount <= 1) {
                return { status: "failure", output: "fail", durationMs: 1, error: "bad" };
              }
              return { status: "success", output: "ok", durationMs: 1 };
            },
          },
        ],
        onFailure: agentic("fix", "fix", {
          agent: "claude-code",
          prompt: () => "fix it",
        }),
      }),
    ]);
    await executeBlueprint(bp, baseContext(), {
      sandbox: mockSandbox(),
      agentExecutor: mockAgent(),
      onNodeStart: (name) => events.push({ type: "start", name }),
      onNodeComplete: (name) => events.push({ type: "complete", name }),
    });
    const fixStart = events.findIndex((e) => e.type === "start" && e.name === "fix");
    const fixComplete = events.findIndex((e) => e.type === "complete" && e.name === "fix");
    expect(fixStart).toBeGreaterThanOrEqual(0);
    expect(fixComplete).toBeGreaterThan(fixStart);
  });
});

describe("DSL functions", () => {
  test("blueprint() returns valid Blueprint", () => {
    const bp = blueprint("my-bp", "desc", []);
    expect(bp.name).toBe("my-bp");
    expect(bp.description).toBe("desc");
    expect(bp.nodes).toEqual([]);
  });

  test("preflight() returns PreflightNode", () => {
    const node = preflight("check", "desc", async () => ({
      status: "success",
      output: "",
      durationMs: 0,
    }));
    expect(node.type).toBe("preflight");
    expect(node.name).toBe("check");
  });

  test("deterministic() returns DeterministicNode", () => {
    const node = deterministic("build", "desc", async () => ({
      status: "success",
      output: "",
      durationMs: 0,
    }));
    expect(node.type).toBe("deterministic");
  });

  test("agentic() returns AgenticNode", () => {
    const node = agentic("impl", "desc", {
      agent: "claude-code",
      prompt: () => "do it",
    });
    expect(node.type).toBe("agentic");
    expect(node.agent).toBe("claude-code");
  });

  test("validate() returns ValidateNode", () => {
    const node = validate("val", "desc", {
      steps: [],
      onFailure: agentic("fix", "fix", {
        agent: "pi",
        prompt: () => "fix",
      }),
      maxRetries: 3,
    });
    expect(node.type).toBe("validate");
    expect(node.maxRetries).toBe(3);
  });
});
