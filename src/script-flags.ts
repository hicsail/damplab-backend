/**
 * Flags for the hand-run migrate-/backfill- scripts. Any flag the script does
 * not know is an error, not a no-op: these scripts write by default, so a
 * mistyped or borrowed flag (`--dryrun`, another script's `--verify`) must stop
 * the run rather than apply it.
 */
export function parseScriptFlags(args: readonly string[]): { dryRun: boolean } {
  const known = new Set(['--dry', '--dry-run']);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown flag(s): ${unknown.join(' ')}. This script accepts only --dry (or --dry-run); with no flag it writes.`);
  }
  return { dryRun: args.length > 0 };
}
