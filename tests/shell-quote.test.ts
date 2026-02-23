import { describe, test, expect } from "vitest";
import { shellQuote } from "../src/util/shell.js";

describe("shellQuote", () => {
  test("AC-13: simple args", () => {
    expect(shellQuote(["echo", "hello"])).toBe("'echo' 'hello'");
  });

  test("AC-13: single quotes in args", () => {
    expect(shellQuote(["echo", "it's"])).toBe("'echo' 'it'\\''s'");
  });

  test("AC-13: double quotes in args", () => {
    expect(shellQuote(["echo", 'say "hi"'])).toBe("'echo' 'say \"hi\"'");
  });

  test("AC-13: spaces in args", () => {
    expect(shellQuote(["git", "commit", "-m", "fix: the bug"]))
      .toBe("'git' 'commit' '-m' 'fix: the bug'");
  });

  test("AC-13: backticks and dollar signs", () => {
    expect(shellQuote(["echo", "`whoami` $HOME"]))
      .toBe("'echo' '`whoami` $HOME'");
  });

  test("AC-14: empty string arg", () => {
    expect(shellQuote(["echo", ""])).toBe("'echo' ''");
  });

  test("empty argv throws", () => {
    expect(() => shellQuote([])).toThrow(/empty/i);
  });
});
