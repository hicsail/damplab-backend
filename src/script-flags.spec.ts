import { parseScriptFlags } from './script-flags';

describe('parseScriptFlags', () => {
  it('writes only when no flag is given', () => {
    expect(parseScriptFlags([])).toEqual({ dryRun: false });
    expect(parseScriptFlags(['--dry'])).toEqual({ dryRun: true });
    expect(parseScriptFlags(['--dry-run'])).toEqual({ dryRun: true });
  });

  it('refuses a flag it does not know instead of applying', () => {
    expect(() => parseScriptFlags(['--verify'])).toThrow(/Unknown flag\(s\): --verify/);
    expect(() => parseScriptFlags(['--dryrun'])).toThrow(/--dryrun/);
  });
});
