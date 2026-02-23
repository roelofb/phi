---
status: pending
priority: p2
issue_id: "018"
tags: [code-review, security, validation]
dependencies: []
---

# parseGitHubRepo allows `..` as owner/name — path confinement bypass

## Problem Statement

`parseGitHubRepo()` in `src/util/github.ts` splits on `/` and accepts any non-empty segments as owner/name. This means `../evil` or `owner/..` would pass validation. While the resulting clone URL wouldn't resolve on GitHub, the repo name is used to derive `workDir` (e.g., `/home/daytona/workspace/{name}`), and `..` as name would widen path confinement.

## Findings

- **Source**: security-sentinel
- **Location**: `src/util/github.ts` — `parseGitHubRepo()` function
- Owner and name segments are not validated against GitHub's allowed characters
- GitHub usernames/repos only allow `[A-Za-z0-9._-]` (with restrictions on leading/trailing dots and hyphens)

## Proposed Solutions

### Option A: Add regex validation for owner and name
- Validate both match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (no leading dot/hyphen)
- **Pros**: Closes path traversal vector, matches GitHub rules
- **Cons**: Might reject edge-case valid repos (unlikely)
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] `parseGitHubRepo("../evil")` throws
- [ ] `parseGitHubRepo("owner/..")` throws
- [ ] `parseGitHubRepo("owner/repo")` still works
- [ ] Test added for dotdot rejection
