---
problem: CLI rejects local paths like "." when sandbox requires a GitHub repo
symptoms: ['Not a GitHub repo: "." (looks like a local path)', Daytona sandbox crashes on --repo .]
root_cause: parseGitHubRepo rejected all local paths; no resolution layer existed between CLI args and runHarness
solution: Added resolveRepoArg() that detects local paths and resolves via git remote get-url origin; also added SSH URL parsing to parseGitHubRepo
date: 2026-02-23
tags: [cli, ux, github, sandbox, daytona]
---

# Resolve Local Repo Argument

## Problem

`--repo .` is the natural invocation when running from inside a repo, but the Daytona
sandbox needs `owner/repo` to clone via the GitHub API. The CLI was passing the raw
arg straight through to `runHarness()`, which passed it to `parseGitHubRepo()`, which
rightfully rejected local paths.

## Solution

Resolution happens at the **CLI layer**, before `runHarness()`:

1. `resolveRepoArg(repo)` — if the arg looks like a local path (`.`, `./`, `..`, `/`, `~`),
   runs `git remote get-url origin` in that directory and parses the result.
   Otherwise returns the arg unchanged.

2. `parseGitHubRepo()` gained SSH URL support (`git@github.com:owner/repo.git`)
   because that's the most common remote format.

## Key Principle

**Resolve at the edge, not in the core.** `runHarness()` and `createDaytonaSandbox()`
always receive a GitHub reference. The CLI owns the translation from ergonomic user
input to canonical form. This keeps the sandbox code simple and testable without
needing git on the test host.
