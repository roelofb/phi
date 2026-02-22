import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";

/** Generate an 8-char hex run ID */
export function generateRunId(): string {
  return randomBytes(4).toString("hex");
}

const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

/** Validate a repo string (must be a local path or org/repo) */
export function validateRepo(repo: string): void {
  // Local path: starts with /, ./, or ../
  if (repo.startsWith("/") || repo.startsWith("./") || repo.startsWith("../")) {
    return;
  }
  // org/repo pattern
  if (REPO_PATTERN.test(repo)) {
    return;
  }
  throw new Error(
    `Invalid repo: "${repo}". Must be a local path (/, ./, ../) or org/repo format.`,
  );
}

/** Validate that a directory exists and is a git repo */
export async function validateGitRepo(dir: string): Promise<void> {
  try {
    const gitDir = join(dir, ".git");
    const s = await stat(gitDir);
    if (!s.isDirectory()) {
      throw new Error(`${dir} is not a git repository (.git is not a directory)`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${dir} is not a git repository (no .git directory found)`);
    }
    throw err;
  }
}
