import { ForbiddenException } from '@nestjs/common';
import { Role } from '../auth/roles/roles.enum';
import { InvoiceResolver } from './invoice.resolver';

/**
 * Who may list a job's invoices. Pinned because this query used to accept only
 * damplab-staff or the submitter's sub, while every other financial read also
 * accepted the client named on a staff-submitted job — so that client saw their
 * balance and payments but got "no permission" on the invoice card.
 */
const job = { _id: 'job-1', sub: 'submitter-sub', email: 'staff@lab.org', clientEmail: 'Client@Example.org' };
const user = (over: Record<string, unknown>): any => ({ sub: 'x', email: 'x@example.org', realm_access: { roles: [] }, ...over });

const build = (): { resolver: InvoiceResolver; findByJobId: jest.Mock } => {
  const findByJobId = jest.fn().mockResolvedValue([{ _id: 'inv-1' }]);
  const resolver = new InvoiceResolver({ findByJobId } as any, { findById: jest.fn().mockResolvedValue(job) } as any, {} as any, {} as any);
  return { resolver, findByJobId };
};

describe('invoicesByJobId — who may read', () => {
  it('admits the submitter by sub', async () => {
    await expect(build().resolver.invoicesByJobId('job-1', user({ sub: 'submitter-sub' }))).resolves.toHaveLength(1);
  });

  it('admits the client named on a staff-submitted job, matching the email case-insensitively', async () => {
    await expect(build().resolver.invoicesByJobId('job-1', user({ email: 'client@example.org' }))).resolves.toHaveLength(1);
  });

  it('admits an equipment user the same way as any client — by the email on the job', async () => {
    await expect(build().resolver.invoicesByJobId('job-1', user({ email: 'client@example.org', realm_access: { roles: [Role.ClientUnassistedEquipmentUser] } }))).resolves.toHaveLength(1);
  });

  it('admits staff and technicians through jobs:view-all', async () => {
    for (const role of [Role.DamplabStaff, Role.Technician]) {
      await expect(build().resolver.invoicesByJobId('job-1', user({ realm_access: { roles: [role] } }))).resolves.toHaveLength(1);
    }
  });

  it('refuses anyone else without confirming the job exists', async () => {
    const { resolver, findByJobId } = build();
    await expect(resolver.invoicesByJobId('job-1', user({}))).rejects.toThrow(ForbiddenException);
    expect(findByJobId).not.toHaveBeenCalled();
  });
});
