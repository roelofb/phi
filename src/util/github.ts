const GITHUB_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Parse a GitHub repo reference into owner and name. */
export function parseGitHubRepo(repo: string): { owner: string; name: string } {
  // Reject local paths
  if (
    repo.startsWith("/") ||
    repo.startsWith("~") ||
    repo.startsWith("./") ||
    repo.startsWith("..") ||
    repo === "."
  ) {
    throw new Error(`Not a GitHub repo: "${repo}" (looks like a local path)`);
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
