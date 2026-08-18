import { SOWService } from './sow.service';

/**
 * SOW numbering. The failure this guards against is a duplicate: sorting numbers
 * as strings can rank a smaller one highest, so the "next" number is one that
 * already exists and the unique index rejects the insert.
 */

function serviceWith(sowNumbers: string[]): SOWService {
  const model: any = {
    find: () => ({ lean: () => ({ exec: async () => sowNumbers.map((sowNumber) => ({ sowNumber })) }) })
  };
  return new SOWService(model, {} as any, {} as any, {} as any, {} as any, {} as any);
}

describe('parseSowNumber', () => {
  it('reads the numeric part regardless of padding', () => {
    expect(SOWService.parseSowNumber('SOW 001')).toBe(1);
    expect(SOWService.parseSowNumber('SOW 00012')).toBe(12);
    expect(SOWService.parseSowNumber('sow 42')).toBe(42);
  });

  it('returns null for anything it cannot read', () => {
    expect(SOWService.parseSowNumber('draft')).toBeNull();
    expect(SOWService.parseSowNumber(undefined)).toBeNull();
    expect(SOWService.parseSowNumber(null)).toBeNull();
  });
});

describe('generateSOWNumber', () => {
  it('starts at 1 when there are no SOWs', async () => {
    await expect(serviceWith([]).generateSOWNumber()).resolves.toBe('SOW 00001');
  });

  it('continues from the highest number', async () => {
    await expect(serviceWith(['SOW 00004', 'SOW 00012']).generateSOWNumber()).resolves.toBe('SOW 00013');
  });

  it('compares numerically, not as strings', async () => {
    // A string sort ranks "SOW 013" above "SOW 00099"; taking that as the maximum
    // would return "SOW 00014", a number below one already in use.
    await expect(serviceWith(['SOW 013', 'SOW 00099']).generateSOWNumber()).resolves.toBe('SOW 00100');
  });

  it('emits one consistent width, whatever the existing rows look like', async () => {
    await expect(serviceWith(['SOW 001']).generateSOWNumber()).resolves.toBe('SOW 00002');
  });

  it('steps past a number that is taken but unparseable in the maximum', async () => {
    // "SOW 00003" is present, so 3 must not be handed out again even though the
    // highest parseable value is 2.
    await expect(serviceWith(['SOW 00002', 'SOW 00003']).generateSOWNumber()).resolves.toBe('SOW 00004');
  });

  it('ignores rows whose number cannot be parsed', async () => {
    await expect(serviceWith(['pending', 'SOW 00007']).generateSOWNumber()).resolves.toBe('SOW 00008');
  });
});
