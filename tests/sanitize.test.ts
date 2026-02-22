import { describe, test, expect } from "vitest";
import {
  slugify,
  redact,
  truncate,
  SECRET_PATTERNS,
  MAX_OUTPUT_BYTES,
} from "../src/util/sanitize.js";
import { generateRunId, validateRepo, validateGitRepo } from "../src/util/preflight.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

describe("slugify", () => {
  test("normal string", () => {
    expect(slugify("Hello World!! 123")).toBe("hello-world-123");
  });

  test("empty string", () => {
    expect(slugify("")).toBe("");
  });

  test("strips leading/trailing hyphens", () => {
    expect(slugify("---abc---")).toBe("abc");
  });

  test("max 64 chars", () => {
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(64);
  });

  test("collapses consecutive hyphens", () => {
    expect(slugify("hello   world")).toBe("hello-world");
  });
});

describe("redact", () => {
  test("by value (≥8 chars)", () => {
    const env = { API_KEY: "sk-abcdef123456" };
    const result = redact("key=sk-abcdef123456", env);
    expect(result).not.toContain("sk-abcdef123456");
  });

  test("skips short values (<8 chars)", () => {
    const env = { X: "ab" };
    expect(redact("val=ab", env)).toContain("ab");
  });

  test("by name pattern (SECRET_PATTERNS match)", () => {
    const env = { MY_SECRET_TOKEN: "longvalue123" };
    const result = redact("found longvalue123 here", env);
    expect(result).toContain("[REDACTED:MY_SECRET_TOKEN]");
    expect(result).not.toContain("longvalue123");
  });

  test("longer values redacted first", () => {
    const env = {
      SHORT_KEY: "abcdefgh",
      LONG_TOKEN: "abcdefghijklmnop",
    };
    const result = redact("value: abcdefghijklmnop", env);
    expect(result).toContain("[REDACTED:LONG_TOKEN]");
  });

  test("non-secret name with long value", () => {
    const env = { SOME_SETTING: "notsecretbutlong" };
    const result = redact("val=notsecretbutlong", env);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("notsecretbutlong");
  });
});

describe("truncate", () => {
  test("within limit", () => {
    expect(truncate("hello", 1024)).toBe("hello");
  });

  test("exceeds limit", () => {
    const result = truncate("x".repeat(100), 50);
    expect(result).toContain("[truncated]");
    const prefix = result.split("\n[truncated]")[0]!;
    expect(Buffer.byteLength(prefix)).toBeLessThanOrEqual(50);
  });
});

describe("MAX_OUTPUT_BYTES", () => {
  test("is 50KB", () => {
    expect(MAX_OUTPUT_BYTES).toBe(50 * 1024);
  });
});

describe("SECRET_PATTERNS", () => {
  test("matches expected suffixes", () => {
    const names = ["API_KEY", "AUTH_TOKEN", "DB_SECRET", "USER_PASSWORD", "AWS_CREDENTIAL"];
    for (const name of names) {
      expect(SECRET_PATTERNS.some((p) => p.test(name))).toBe(true);
    }
  });

  test("does not match non-secret names", () => {
    const names = ["USERNAME", "HOST", "PORT"];
    for (const name of names) {
      expect(SECRET_PATTERNS.some((p) => p.test(name))).toBe(false);
    }
  });
});

describe("generateRunId", () => {
  test("format", () => {
    expect(generateRunId()).toMatch(/^[0-9a-f]{8}$/);
  });

  test("unique", () => {
    const a = generateRunId();
    const b = generateRunId();
    expect(a).not.toBe(b);
  });
});

describe("validateRepo", () => {
  test("local path (./)", () => {
    expect(() => validateRepo("./foo")).not.toThrow();
  });

  test("local path (../)", () => {
    expect(() => validateRepo("../foo")).not.toThrow();
  });

  test("local path (/absolute)", () => {
    expect(() => validateRepo("/tmp/repo")).not.toThrow();
  });

  test("org/repo", () => {
    expect(() => validateRepo("stripe/stripe-node")).not.toThrow();
  });

  test("invalid (spaces)", () => {
    expect(() => validateRepo("not valid!")).toThrow();
  });

  test("invalid (empty)", () => {
    expect(() => validateRepo("")).toThrow();
  });
});

describe("validateGitRepo", () => {
  let testDir: string;

  test("valid git repo", async () => {
    testDir = await mkdtemp(join(tmpdir(), "harness-test-"));
    execFileSync("git", ["init"], { cwd: testDir });
    await expect(validateGitRepo(testDir)).resolves.not.toThrow();
    await rm(testDir, { recursive: true, force: true });
  });

  test("not a git repo", async () => {
    testDir = await mkdtemp(join(tmpdir(), "harness-test-"));
    await expect(validateGitRepo(testDir)).rejects.toThrow(/not a git repository/i);
    await rm(testDir, { recursive: true, force: true });
  });
});
