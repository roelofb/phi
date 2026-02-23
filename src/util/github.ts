import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { resolve as resolvePath } from "node:path";

const execFile = promisify(execFileCb);
const GITHUB_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isLocalPath(repo: string): boolean {
  return (
    repo === "." ||
    repo.startsWith("./") ||
    repo.startsWith("..") ||
    repo.startsWith("/") ||
    repo.startsWith("~") ||
    /^[A-Za-z]:/.test(repo)
  );
}

/**
 * If repo looks like a local path, resolve it to owner/repo via the
 * git origin remote. Otherwise return it unchanged.
 */
export async function resolveRepoArg(repo: string): Promise<string> {
  if (!isLocalPath(repo)) return repo;

  const cwd = resolvePath(repo);
  const { stdout } = await execFile("git", ["remote", "get-url", "origin"], { cwd });
  const url = stdout.trim();
  if (!url) {
    throw new Error(`No git remote "origin" in ${cwd}`);
  }
  const { owner, name } = parseGitHubRepo(url);
  return `${owner}/${name}`;
}

/** Parse a GitHub repo reference into owner and name. */
export function parseGitHubRepo(repo: string): { owner: string; name: string } {
  // Reject local paths
  if (isLocalPath(repo)) {
    throw new Error(`Not a GitHub repo: "${repo}" (looks like a local path)`);
  }

  // SSH URL: git@github.com:org/repo[.git]
  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(repo);
  if (sshMatch) {
    return validateOwnerName(sshMatch[1]!, sshMatch[2]!, repo);
  }

  // Full URL: https://github.com/org/repo[.git]
  if (repo.startsWith("https://") || repo.startsWith("http://")) {
    const url = new URL(repo);
    if (url.hostname !== "github.com") {
      throw new Error(`Not a GitHub repo: "${repo}" (host is ${url.hostname})`);
    }
    const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      throw new Error(`Not a GitHub repo: "${repo}" (expected org/repo path)`);
    }
    return validateOwnerName(parts[0], parts[1], repo);
  }

  // Bare name without slash — not org/repo
  if (!repo.includes("/")) {
    throw new Error(`Not a GitHub repo: "${repo}" (expected org/repo)`);
  }

  // Windows drive letter
  if (/^[A-Za-z]:/.test(repo)) {
    throw new Error(`Not a GitHub repo: "${repo}" (looks like a local path)`);
  }

  // org/repo shorthand (possibly with .git suffix)
  const clean = repo.replace(/\.git$/, "");
  const parts = clean.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Not a GitHub repo: "${repo}" (expected exactly org/repo)`);
  }
  return validateOwnerName(parts[0], parts[1], repo);
}

function validateOwnerName(owner: string, name: string, repo: string): { owner: string; name: string } {
  if (!GITHUB_NAME_RE.test(owner) || !GITHUB_NAME_RE.test(name)) {
    throw new Error(`Not a GitHub repo: "${repo}" (owner/name contains invalid characters)`);
  }
  return { owner, name };
}
