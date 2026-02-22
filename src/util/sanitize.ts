/** Secret name patterns that trigger redaction (case-insensitive suffix match) */
export const SECRET_PATTERNS: RegExp[] = [
  /KEY$/i,
  /TOKEN$/i,
  /SECRET$/i,
  /PASSWORD$/i,
  /CREDENTIAL$/i,
];

/** Default output cap in bytes */
export const MAX_OUTPUT_BYTES = 50 * 1024;

/**
 * Slugify a string for branch names, file paths, etc.
 * Lowercase alphanumeric + hyphens, max 64 chars, no leading/trailing hyphens.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Redact secrets from output.
 * 1. By name: env vars whose names match SECRET_PATTERNS → [REDACTED:<NAME>]
 * 2. By value: any env value ≥8 chars → [REDACTED]
 * Longer values are redacted first to handle overlapping matches.
 */
export function redact(output: string, env: Record<string, string>): string {
  let result = output;

  // Collect entries sorted by value length descending (longer match wins)
  const entries = Object.entries(env)
    .filter(([_, v]) => v.length >= 8)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [name, value] of entries) {
    const isSecretName = SECRET_PATTERNS.some((p) => p.test(name));
    const replacement = isSecretName ? `[REDACTED:${name}]` : "[REDACTED]";
    // Escape regex special chars in value
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), replacement);
  }

  return result;
}

/** Truncate output to maxBytes, appending "[truncated]" if exceeded */
export function truncate(output: string, maxBytes: number): string {
  const buf = Buffer.from(output, "utf-8");
  if (buf.length <= maxBytes) return output;
  return buf.subarray(0, maxBytes).toString("utf-8") + "\n[truncated]";
}
