import { CustomerProfileService, toCustomerProfile } from './customer-profile.service';
import { CustomerProfileStatus, PROFILE_FIELDS } from './customer-profile.model';

/** A Mongoose model stub that records its calls and answers from `docs`. */
function modelStub(docs: any[] = []): { model: any; calls: any[] } {
  const calls: any[] = [];
  const model: any = {
    findOne: (filter: any) => {
      calls.push(['findOne', filter]);
      return { lean: () => ({ exec: async () => docs.find((d) => d.userSub === filter.userSub) ?? null }) };
    },
    find: (filter: any) => {
      calls.push(['find', filter]);
      return { lean: () => ({ exec: async () => docs.filter((d) => filter.userSub.$in.includes(d.userSub)) }) };
    },
    findOneAndUpdate: (filter: any, update: any, options: any) => {
      calls.push(['findOneAndUpdate', filter, update, options]);
      return { lean: () => ({ exec: async () => ({ userSub: filter.userSub, canBookWithoutApproval: false, ...update.$set }) }) };
    }
  };
  return { model, calls };
}

describe('toCustomerProfile', () => {
  it('reads a missing record as every field null and the flag off', () => {
    const p = toCustomerProfile('sub-1', null);
    expect(p.userSub).toBe('sub-1');
    expect(p.canBookWithoutApproval).toBe(false);
    for (const f of PROFILE_FIELDS) expect(p[f]).toBeNull();
    expect(p.updatedAt).toBeNull();
    expect(p.updatedBySub).toBeNull();
  });

  it('keeps stored values', () => {
    const p = toCustomerProfile('sub-1', { userSub: 'sub-1', canBookWithoutApproval: true, position: 'Postdoc', status: CustomerProfileStatus.ACTIVE });
    expect(p).toMatchObject({ canBookWithoutApproval: true, position: 'Postdoc', status: 'ACTIVE', group: null });
  });
});

describe('CustomerProfileService', () => {
  it('finds one profile by sub', async () => {
    const { model } = modelStub([{ userSub: 'a', position: 'PI' }]);
    const svc = new CustomerProfileService(model);
    expect((await svc.findBySub('a'))?.position).toBe('PI');
    expect(await svc.findBySub('missing')).toBeNull();
    expect(await svc.findBySub('')).toBeNull();
  });

  it('finds many in one $in query, keyed by sub, de-duplicating the input', async () => {
    const { model, calls } = modelStub([{ userSub: 'a' }, { userSub: 'b' }]);
    const map = await new CustomerProfileService(model).findBySubs(['a', 'b', 'a', 'c']);
    expect(calls).toEqual([['find', { userSub: { $in: ['a', 'b', 'c'] } }]]);
    expect([...map.keys()].sort()).toEqual(['a', 'b']);
  });

  it('skips the query entirely for an empty list', async () => {
    const { model, calls } = modelStub();
    expect((await new CustomerProfileService(model).findBySubs([])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('upserts only the fields present, clears empty strings and nulls, and stamps who and when', async () => {
    const { model, calls } = modelStub();
    const out = await new CustomerProfileService(model).upsert('sub-1', { position: '  Postdoc ', group: '', status: null, canBookWithoutApproval: true }, 'admin-sub');
    const [, filter, update, options] = calls[0];
    expect(filter).toEqual({ userSub: 'sub-1' });
    expect(update.$set).toMatchObject({ position: 'Postdoc', canBookWithoutApproval: true, updatedBySub: 'admin-sub' });
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(update.$unset).toEqual({ group: '', status: '' });
    // Absent fields are untouched: not in $set, not in $unset.
    expect(update.$set).not.toHaveProperty('instrumentType');
    expect(update.$unset).not.toHaveProperty('instrumentType');
    expect(options).toMatchObject({ upsert: true, new: true, setDefaultsOnInsert: true });
    expect(out).toMatchObject({ userSub: 'sub-1', position: 'Postdoc', canBookWithoutApproval: true, group: null });
  });

  it('treats a null flag as false rather than clearing it', async () => {
    const { model, calls } = modelStub();
    await new CustomerProfileService(model).upsert('sub-1', { canBookWithoutApproval: null }, 'admin-sub');
    expect(calls[0][2].$set.canBookWithoutApproval).toBe(false);
    expect(calls[0][2]).not.toHaveProperty('$unset');
  });

  it('answers the booking question from the stored flag, false when nothing is stored', async () => {
    const { model } = modelStub([
      { userSub: 'trusted', canBookWithoutApproval: true },
      { userSub: 'off', canBookWithoutApproval: false }
    ]);
    const svc = new CustomerProfileService(model);
    expect(await svc.canBookWithoutApproval('trusted')).toBe(true);
    expect(await svc.canBookWithoutApproval('off')).toBe(false);
    expect(await svc.canBookWithoutApproval('nobody')).toBe(false);
    expect(await svc.canBookWithoutApproval(undefined)).toBe(false);
  });
});
