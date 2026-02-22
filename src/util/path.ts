import { resolve, relative, isAbsolute } from "node:path";

/** Assert that candidate path resolves within root. Throws on violation. */
export function assertPathConfined(candidate: string, root: string): void {
  const resolved = resolve(candidate);
  const rootResolved = resolve(root);
  const rel = relative(rootResolved, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `Path confinement violation: "${candidate}" resolves outside sandbox root "${root}"`,
    );
  }
}
