import { describe, test, expect } from "vitest";
import { parseGitHubRepo } from "../src/util/github.js";

describe("parseGitHubRepo", () => {
  test("org/repo shorthand", () => {
    expect(parseGitHubRepo("acme/widgets")).toEqual({ owner: "acme", name: "widgets" });
  });

  test("full HTTPS URL", () => {
    expect(parseGitHubRepo("https://github.com/acme/widgets")).toEqual({ owner: "acme", name: "widgets" });
  });

  test("full HTTPS URL with .git suffix", () => {
    expect(parseGitHubRepo("https://github.com/acme/widgets.git")).toEqual({ owner: "acme", name: "widgets" });
  });

  test("rejects non-GitHub host", () => {
    expect(() => parseGitHubRepo("https://gitlab.com/acme/widgets")).toThrow();
  });

  test("rejects bare name (no slash)", () => {
    expect(() => parseGitHubRepo("widgets")).toThrow();
  });

  test("rejects local path", () => {
    expect(() => parseGitHubRepo("./my-project")).toThrow();
    expect(() => parseGitHubRepo("/Users/x/repo")).toThrow();
  });

  test("rejects dotdot as owner or name", () => {
    expect(() => parseGitHubRepo("../evil")).toThrow();
    expect(() => parseGitHubRepo("acme/..")).toThrow(/invalid characters/);
    expect(() => parseGitHubRepo("../..")).toThrow();
  });

  test("rejects extra path segments", () => {
    expect(() => parseGitHubRepo("acme/repo/tree/main")).toThrow(/expected exactly org\/repo/);
  });

  test("allows dots and hyphens in names", () => {
    expect(parseGitHubRepo("my-org/my-repo.js")).toEqual({ owner: "my-org", name: "my-repo.js" });
    expect(parseGitHubRepo("org123/repo_v2")).toEqual({ owner: "org123", name: "repo_v2" });
  });
});
