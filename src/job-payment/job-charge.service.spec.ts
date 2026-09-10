import { JobChargeService, CHARGE_MESSAGES } from './job-charge.service';
import { JobChargeKind } from './job-charge.model';
import { User } from '../auth/user.interface';

const staff = { sub: 'tech-sub', email: 'tech@bu.edu' } as unknown as User;

function harness(existing: any[] = []): { service: JobChargeService; rows: any[] } {
  const rows = [...existing];
  const model: any = {
    find: (filter: any = {}) => ({
      sort: () => ({ exec: async (): Promise<any[]> => rows.filter((r) => (filter.voidedAt === null ? r.voidedAt == null : true)) }),
      exec: async (): Promise<any[]> => rows.filter((r) => (filter.voidedAt === null ? r.voidedAt == null : true))
    }),
    findById: (id: string) => ({ exec: async (): Promise<any> => rows.find((r) => String(r._id) === String(id)) ?? null }),
    findOneAndUpdate: (filter: any, update: any) => ({
      exec: async (): Promise<any> => {
        const found = rows.find((r) => String(r._id) === String(filter._id) && r.voidedAt == null);
        if (!found) return null;
        Object.assign(found, update.$set);
        return found;
      }
    }),
    create: async (doc: any): Promise<any> => {
      const saved = { _id: `chg-${rows.length + 1}`, ...doc };
      rows.push(saved);
      return saved;
    },
    insertMany: async (docs: any[]): Promise<any[]> =>
      docs.map((doc) => {
        const saved = { _id: `chg-${rows.length + 1}`, ...doc };
        rows.push(saved);
        return saved;
      })
  };
  const jobService: any = { findById: async (id: string) => (id === 'job-1' ? { _id: 'job-1', name: 'Test job' } : null) };
  return { service: new JobChargeService(model, jobService), rows };
}

describe('addCharge', () => {
  it('records who added it and when, keyed on the job’s own _id', async () => {
    const { service } = harness();
    const charge: any = await service.addCharge({ jobId: 'job-1', kind: JobChargeKind.CUSTOM, label: '  Courier  ', amount: 42.005 }, staff);
    expect(charge.jobId).toBe('job-1');
    expect(charge.label).toBe('Courier');
    expect(charge.amount).toBe(42.01);
    expect(charge.addedBy).toBe('tech@bu.edu');
    expect(charge.addedAt).toBeInstanceOf(Date);
  });

  it('requires a label', async () => {
    const { service } = harness();
    await expect(service.addCharge({ jobId: 'job-1', kind: JobChargeKind.CUSTOM, label: '   ', amount: 10 }, staff)).rejects.toThrow('A label is required for a charge.');
  });

  it('lets a CUSTOM line be negative but never zero', async () => {
    const { service } = harness();
    await expect(service.addCharge({ jobId: 'job-1', kind: JobChargeKind.CUSTOM, label: 'Credit', amount: -25 }, staff)).resolves.toBeDefined();
    await expect(service.addCharge({ jobId: 'job-1', kind: JobChargeKind.CUSTOM, label: 'Nothing', amount: 0 }, staff)).rejects.toThrow('A charge amount cannot be zero.');
  });

  it('requires a deposit to be greater than zero', async () => {
    const { service } = harness();
    for (const amount of [0, -50]) {
      await expect(service.addCharge({ jobId: 'job-1', kind: JobChargeKind.DEPOSIT, label: 'Deposit', amount }, staff)).rejects.toThrow('A deposit must be greater than zero.');
    }
  });

  it('refuses SERVICE_LINE, which only invoice generation may create', async () => {
    const { service } = harness();
    await expect(service.addCharge({ jobId: 'job-1', kind: 'SERVICE_LINE' as any, label: 'PCR', amount: 100 }, staff)).rejects.toThrow(/service line/i);
  });

  it('refuses a job that does not exist', async () => {
    const { service } = harness();
    await expect(service.addCharge({ jobId: 'nope', kind: JobChargeKind.CUSTOM, label: 'x', amount: 1 }, staff)).rejects.toThrow(/not found/i);
  });

  it('stores a note against a custom charge', async () => {
    const { service } = harness();
    const charge = await service.addCharge({ jobId: 'job-1', kind: JobChargeKind.CUSTOM, label: 'Courier', amount: 25, note: '  Overnight to Cambridge  ' } as any, staff);
    expect((charge as any).note).toBe('Overnight to Cambridge');
  });

  it('stores no note at all when the field is blank', async () => {
    const { service } = harness();
    const charge = await service.addCharge({ jobId: 'job-1', kind: JobChargeKind.CUSTOM, label: 'Courier', amount: 25, note: '   ' } as any, staff);
    expect((charge as any).note).toBeUndefined();
  });

  it('requires a due date on a deposit', async () => {
    const { service } = harness();
    await expect(service.addCharge({ jobId: 'job-1', kind: JobChargeKind.DEPOSIT, label: 'Deposit', amount: 500 }, staff)).rejects.toThrow(CHARGE_MESSAGES.depositDueDateRequired);
  });

  it('stores the deposit with its due date', async () => {
    const { service } = harness();
    const due = new Date('2026-10-01T12:00:00Z');
    const charge: any = await service.addCharge({ jobId: 'job-1', kind: JobChargeKind.DEPOSIT, label: 'Deposit', amount: 500, dueDate: due }, staff);
    expect(charge).toMatchObject({ kind: 'DEPOSIT', amount: 500, dueDate: due });
  });

  it('refuses a second deposit while one stands on the job', async () => {
    const { service } = harness([{ _id: 'chg-1', jobId: 'job-1', kind: 'DEPOSIT', label: 'Deposit', amount: 300 }]);
    await expect(service.addCharge({ jobId: 'job-1', kind: JobChargeKind.DEPOSIT, label: 'Deposit', amount: 500, dueDate: new Date() }, staff)).rejects.toThrow(CHARGE_MESSAGES.depositExists);
  });

  it('allows a new deposit once the old one is voided', async () => {
    const { service } = harness([{ _id: 'chg-1', jobId: 'job-1', kind: 'DEPOSIT', label: 'Deposit', amount: 300, voidedAt: new Date() }]);
    await expect(service.addCharge({ jobId: 'job-1', kind: JobChargeKind.DEPOSIT, label: 'Deposit', amount: 500, dueDate: new Date() }, staff)).resolves.toBeDefined();
  });

  it('never stores a due date on a custom line', async () => {
    const { service } = harness();
    const charge: any = await service.addCharge({ jobId: 'job-1', kind: JobChargeKind.CUSTOM, label: 'Courier', amount: 25, dueDate: new Date() }, staff);
    expect(charge.dueDate).toBeUndefined();
  });

  it('refuses with the exact shared messages', async () => {
    const { service } = harness();
    await expect(service.addCharge({ jobId: 'job-1', kind: JobChargeKind.CUSTOM, label: '  ', amount: 5 } as any, staff)).rejects.toThrow(CHARGE_MESSAGES.labelRequired);
    await expect(service.addCharge({ jobId: 'job-1', kind: JobChargeKind.CUSTOM, label: 'x', amount: 0 } as any, staff)).rejects.toThrow(CHARGE_MESSAGES.amountZero);
    await expect(service.addCharge({ jobId: 'job-1', kind: JobChargeKind.DEPOSIT, label: 'x', amount: 0 } as any, staff)).rejects.toThrow(CHARGE_MESSAGES.depositNotPositive);
  });
});

describe('voidCharge', () => {
  const live = { _id: 'chg-1', jobId: 'job-1', kind: 'SERVICE_LINE', label: 'PCR', amount: 350, sourceIndex: 0 };

  it('records who voided it, when and why, keeping the record', async () => {
    const { service, rows } = harness([{ ...live }]);
    const voided: any = await service.voidCharge('chg-1', '  Held back  ', staff);
    expect(voided.voidReason).toBe('Held back');
    expect(voided.voidedBy).toBe('tech@bu.edu');
    expect(voided.voidedAt).toBeInstanceOf(Date);
    expect(rows).toHaveLength(1);
  });

  it('requires a reason', async () => {
    const { service } = harness([{ ...live }]);
    await expect(service.voidCharge('chg-1', '  ', staff)).rejects.toThrow('A reason is required to void a charge.');
  });

  it('refuses one that is already void rather than overwriting its reason', async () => {
    const { service } = harness([{ ...live, voidedAt: new Date(), voidedBy: 'first@bu.edu', voidReason: 'First' }]);
    await expect(service.voidCharge('chg-1', 'Second', staff)).rejects.toThrow('That charge has already been voided.');
  });

  it('refuses one that does not exist', async () => {
    const { service } = harness();
    await expect(service.voidCharge('nope', 'Any', staff)).rejects.toThrow(/not found/i);
  });
});
