---
module: Sandbox
date: 2026-02-22
problem_type: security_issue
component: tooling
symptoms:
  - "assertPathConfined using startsWith allows sibling directory bypass"
  - "/tmp/root2/file passes confinement check for /tmp/root"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [path-confinement, security, startswith-bypass, path-traversal]
---

# Troubleshooting: Path Confinement Sibling-Prefix Bypass

## Problem

The `assertPathConfined` function used `String.startsWith()` to verify paths stayed within a root directory. A path like `/tmp/root2/file` would pass the confinement check for root `/tmp/root` because `"/tmp/root2/file".startsWith("/tmp/root")` is `true`.

## Environment
- Module: Sandbox (local sandbox implementation)
- Affected Component: `src/sandbox/local.ts` → moved to `src/util/path.ts`
- Date: 2026-02-22

## Symptoms
- `assertPathConfined("/tmp/root2/file", "/tmp/root")` does NOT throw
- Sandbox exec and uploadFiles could operate on sibling directories sharing a path prefix
- Any worktree at `/tmp/harness-XXXX` could escape to `/tmp/harness-XXXX2` (unlikely but exploitable)

## What Didn't Work

**Direct solution:** The problem was identified during code review (Phase 2 plan) and fixed on first attempt.

## Solution

Replace `String.startsWith()` with `path.relative()` to compute the actual relationship between paths.

**Code changes:**

```typescript
// Before (broken):
function assertPathConfined(candidate: string, root: string): void {
  const resolved = resolve(candidate);
  if (!resolved.startsWith(root)) {
    throw new Error(`Path confinement violation: ...`);
  }
}

// After (fixed):
import { resolve, relative, isAbsolute } from "node:path";

export function assertPathConfined(candidate: string, root: string): void {
  const resolved = resolve(candidate);
  const rootResolved = resolve(root);
  const rel = relative(rootResolved, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path confinement violation: ...`);
  }
}
```

Also moved from `src/sandbox/local.ts` to `src/util/path.ts` since it's a general-purpose security utility used by both sandbox and blueprints.

## Why This Works

1. **Root cause:** `String.startsWith()` treats paths as opaque strings, ignoring filesystem semantics. `/tmp/root` is a prefix of `/tmp/root2` as a string, but not as a directory hierarchy.

2. **Fix mechanism:** `path.relative(root, candidate)` computes the actual relative path. If the candidate is outside root, the relative path starts with `..` (going up). If they're on different drives (Windows), `isAbsolute()` catches it.

3. **Edge cases handled:**
   - `/tmp/root` relative to `/tmp/root` → `""` (empty string, valid — root itself)
   - `/tmp/root/sub` relative to `/tmp/root` → `"sub"` (valid — inside root)
   - `/tmp/root2` relative to `/tmp/root` → `"../root2"` (starts with `..`, rejected)
   - `/tmp/root/../other` resolves to `/tmp/other`, then relative → `"../other"` (rejected)

## Prevention

- **Never use `startsWith` for path confinement.** Always use `path.relative()` + check for `..` prefix.
- This is a well-known vulnerability pattern (CWE-22: Path Traversal). The `startsWith` variant is particularly insidious because it looks correct at first glance.
- Test path confinement with sibling-prefix paths: if root is `/a/b`, test `/a/bc` — this catches `startsWith` bugs.
- The function is now in `src/util/path.ts` — import from there, not from sandbox.

## Related Issues

No related issues documented yet.
