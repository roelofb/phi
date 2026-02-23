/**
 * Convert argv array to a safely-quoted shell command string.
 * Uses POSIX single-quote escaping — no variable expansion, no globbing.
 */
export function shellQuote(argv: string[]): string {
  if (argv.length === 0) throw new Error("Empty argv");
  return argv.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(" ");
}
