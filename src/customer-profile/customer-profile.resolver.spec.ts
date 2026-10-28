import { CustomerProfileResolver } from './customer-profile.resolver';

describe('CustomerProfileResolver', () => {
  const stored = { userSub: 'u-1', canBookWithoutApproval: true, position: 'PI' };
  const service = (): any => ({
    upsert: jest.fn(async (sub: string, input: any) => ({ userSub: sub, canBookWithoutApproval: !!input.canBookWithoutApproval })),
    findBySub: jest.fn(async (sub: string) => (sub === 'u-1' ? stored : null))
  });

  it('upserts the target user, stamping the acting administrator', async () => {
    const svc = service();
    const out = await new CustomerProfileResolver(svc).updateCustomerProfile('u-1', { canBookWithoutApproval: true }, { sub: 'admin-sub' } as any);
    expect(svc.upsert).toHaveBeenCalledWith('u-1', { canBookWithoutApproval: true }, 'admin-sub');
    expect(out.canBookWithoutApproval).toBe(true);
  });

  it('returns a pre-attached profile without a lookup', async () => {
    const svc = service();
    const attached = { userSub: 'u-2', canBookWithoutApproval: false } as any;
    expect(await new CustomerProfileResolver(svc).profile({ id: 'u-2', profile: attached } as any)).toBe(attached);
    expect(svc.findBySub).not.toHaveBeenCalled();
  });

  it('looks the profile up when the row did not carry one (the set-category / set-tier mutations)', async () => {
    const svc = service();
    const r = new CustomerProfileResolver(svc);
    expect(await r.profile({ id: 'u-1' } as any)).toMatchObject({ userSub: 'u-1', canBookWithoutApproval: true, position: 'PI', group: null });
    expect(await r.profile({ id: 'nobody' } as any)).toMatchObject({ userSub: 'nobody', canBookWithoutApproval: false, position: null });
  });
});
