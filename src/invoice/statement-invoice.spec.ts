import { InvoiceService } from './invoice.service';
import { User } from '../auth/user.interface';

/**
 * `createForJob` as a statement generator: it releases whatever SOW service
 * lines the caller listed onto the job's charge ledger, then writes a
 * STATEMENT document off the whole ledger (`JobBalanceService.chargeBreakdown`).
 *
 * The two halves are deliberately tested apart. `released` records exactly
 * what the release step wrote to the charge ledger, independent of what the
 * document ends up stating — and `breakdown` is a stand-in for whatever
 * `chargeBreakdown` returns, independent of what got released this call. A
 * real ledger keeps the two in step; this harness does not need to, because
 * `createForJob` never reasons about one in terms of the other — it reads the
 * ledger fresh after releasing onto it.
 */

const staff = { sub: 'staff-sub', email: 'tech@bu.edu', preferred_username: 'tech', realm_access: { roles: ['damplab-staff'] } } as unknown as User;

interface Opts {
  existingInvoices?: any[];
  activeStatus?: string | null;
  hasSow?: boolean;
  versionHistory?: any[];
  activeVersionNumber?: number;
  billableLines?: any[];
  liveCharges?: any[];
  breakdown?: any;
  confirmed?: any[];
}

const defaultBillableLines = [{ serviceId: 's1', name: 'PCR', description: '', cost: 350, category: 'Sequencing' }];

function defaultBreakdown(opts: Opts): any {
  return (
    opts.breakdown ?? {
      jobId: 'job-1',
      serviceLines: [],
      customLines: [],
      depositLines: [],
      bookings: opts.confirmed ?? [],
      adjustments: [],
      prorationFactor: 1,
      chargesToDate: 350,
      paymentsToDate: 0,
      balanceDue: 350,
      confirmedHours: 0,
      unconfirmedBookings: 0
    }
  );
}

function harness(opts: Opts = {}): { service: InvoiceService; created: any[]; released: any[]; added: any[]; dispatched: any[] } {
  const created: any[] = [];
  const released: any[] = [];
  const added: any[] = [];
  const dispatched: any[] = [];
  const existing = opts.existingInvoices ?? [];

  const invoiceModel: any = {
    countDocuments: () => ({ exec: async (): Promise<number> => existing.length }),
    find: () => ({ exec: async (): Promise<any[]> => existing }),
    findById: () => ({ exec: async (): Promise<any> => null }),
    findOneAndUpdate: () => ({ exec: async (): Promise<any> => null }),
    create: async (doc: any): Promise<any> => {
      const saved = { _id: `inv-${created.length + 1}`, ...doc };
      created.push(saved);
      return saved;
    }
  };

  const jobService: any = { findById: async (id: string) => (id === 'job-1' ? { _id: 'job-1', jobId: '04217', name: 'Test job', customerCategory: 'INTERNAL_CUSTOMERS' } : null) };

  const sowService: any = {
    findByJobId: async () => (opts.hasSow === false ? null : { _id: 'sow-1', clientName: 'Dr Client', clientEmail: 'client@bu.edu', clientAddress: '1 Main St' }),
    billableServiceLines: async (): Promise<any[]> => opts.billableLines ?? defaultBillableLines
  };

  const active =
    opts.activeStatus === null ? null : { versionNumber: opts.activeVersionNumber ?? 1000, status: opts.activeStatus ?? 'FINAL', inputs: { customerCategory: 'INTERNAL_CUSTOMERS', adjustments: [] } };
  const sowVersionService: any = { getActiveVersion: async () => active, listVersions: async (): Promise<any[]> => opts.versionHistory ?? (active ? [active] : []) };

  const chargeService: any = {
    liveByJobId: async () => opts.liveCharges ?? [],
    createServiceLineCharges: async (jobId: string, rows: any[]) => {
      released.push(...rows);
      return rows;
    },
    addCharge: async (input: any) => {
      const saved = { _id: `chg-${added.length + 1}`, ...input };
      added.push(saved);
      return saved;
    }
  };

  const breakdown = defaultBreakdown(opts);
  const balances: any = {
    chargeBreakdown: async () => breakdown,
    confirmedBookings: async () => opts.confirmed ?? []
  };

  const dispatch: any = { dispatch: (input: any) => dispatched.push(input) };

  return {
    service: new InvoiceService(invoiceModel, jobService, sowService, sowVersionService, chargeService, balances, dispatch),
    created,
    released,
    added,
    dispatched
  };
}

describe('the gates, in order', () => {
  it('refuses a job that does not exist', async () => {
    const { service } = harness();
    await expect(service.createForJob({ jobId: 'nope' } as any, staff)).rejects.toThrow(/not found/i);
  });

  it('refuses a job with no SOW, in the spec’s words', async () => {
    const { service } = harness({ hasSow: false });
    await expect(service.createForJob({ jobId: 'job-1' } as any, staff)).rejects.toThrow('Cannot generate an invoice until the Statement of Work is countersigned.');
  });

  it.each([['SENT'], ['SIGNED'], ['DRAFT'], ['CANCELLED']])('refuses while the active version is only %s', async (status) => {
    const { service } = harness({ activeStatus: status });
    await expect(service.createForJob({ jobId: 'job-1' } as any, staff)).rejects.toThrow('Cannot generate an invoice until the Statement of Work is countersigned.');
  });

  it('refuses when the SOW has been withdrawn and no version is in force', async () => {
    const { service } = harness({ activeStatus: null });
    await expect(service.createForJob({ jobId: 'job-1' } as any, staff)).rejects.toThrow('Cannot generate an invoice until the Statement of Work is countersigned.');
  });

  it('refuses when there is neither a charge nor a payment to state', async () => {
    const { service } = harness({ breakdown: { ...defaultBreakdown({}), chargesToDate: 0, paymentsToDate: 0, balanceDue: 0, confirmedHours: 0 } });
    await expect(service.createForJob({ jobId: 'job-1' } as any, staff)).rejects.toThrow('Nothing to invoice yet.');
  });

  it('names the missing rate when hours are confirmed but sum to nothing', async () => {
    const { service } = harness({ breakdown: { ...defaultBreakdown({}), chargesToDate: 0, paymentsToDate: 0, balanceDue: 0, confirmedHours: 3 } });
    await expect(service.createForJob({ jobId: 'job-1' } as any, staff)).rejects.toThrow(
      "Confirmed usage on this job has no rate. Set a price for the operation's service and confirm the usage again."
    );
  });

  it('issues a statement that says only what has been paid, when that is all there is', async () => {
    const { service, created } = harness({ breakdown: { ...defaultBreakdown({}), chargesToDate: 0, paymentsToDate: 200, balanceDue: -200, confirmedHours: 0 } });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].balanceDue).toBe(-200);
  });

  it('still refuses "nothing to invoice" when every listed position is already live and the job has zero charges and payments', async () => {
    // A call that releases nothing new must not bypass the refusal just
    // because it listed a position — only an actual new release does.
    const { service } = harness({
      liveCharges: [{ kind: 'SERVICE_LINE', sourceIndex: 0 }],
      breakdown: { ...defaultBreakdown({}), chargesToDate: 0, paymentsToDate: 0, balanceDue: 0, confirmedHours: 0 }
    });
    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow('Nothing to invoice yet.');
  });

  it('still names the missing rate when every listed position is already live and hours are confirmed but sum to nothing', async () => {
    const { service } = harness({
      liveCharges: [{ kind: 'SERVICE_LINE', sourceIndex: 0 }],
      breakdown: { ...defaultBreakdown({}), chargesToDate: 0, paymentsToDate: 0, balanceDue: 0, confirmedHours: 3 }
    });
    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(
      "Confirmed usage on this job has no rate. Set a price for the operation's service and confirm the usage again."
    );
  });

  it('creates no invoice when every listed position is already live, no deposit or custom lines are given, and the job has zero charges and payments', async () => {
    const { service, created } = harness({
      liveCharges: [{ kind: 'SERVICE_LINE', sourceIndex: 0 }],
      breakdown: { ...defaultBreakdown({}), chargesToDate: 0, paymentsToDate: 0, balanceDue: 0, confirmedHours: 0 }
    });
    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow('Nothing to invoice yet.');
    expect(created).toHaveLength(0);
  });
});

describe('releasing service lines', () => {
  it('releases each listed line at the SOW’s own cost, recording the position and version', async () => {
    const { service, released } = harness();
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);
    expect(released[0]).toEqual({ serviceId: 's1', label: 'PCR', amount: 350, sowVersionNumber: 1000, sourceIndex: 0 });
  });

  it('is a no-op for a position that is already live, never a duplicate', async () => {
    const { service, released } = harness({ liveCharges: [{ kind: 'SERVICE_LINE', sourceIndex: 0 }] });
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);
    expect(released).toEqual([]);
  });

  it('is a no-op even when the live charge came off a different SOW version', async () => {
    // The ledger is keyed on sourceIndex within the job: keying on the pair
    // would let a re-countersigned SOW charge the same position twice.
    const { service, released } = harness({ liveCharges: [{ kind: 'SERVICE_LINE', sourceIndex: 0, sowVersionNumber: 500 }], activeVersionNumber: 1000 });
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);
    expect(released).toEqual([]);
  });

  it('does not re-release the same position twice in one call', async () => {
    const { service, released } = harness();
    await service.createForJob(
      {
        jobId: 'job-1',
        releaseServiceLines: [
          { sourceIndex: 0, serviceId: 's1' },
          { sourceIndex: 0, serviceId: 's1' }
        ]
      } as any,
      staff
    );
    expect(released).toHaveLength(1);
  });

  it('refuses a position that is not on the billable lines', async () => {
    const { service: outOfRange } = harness();
    await expect(outOfRange.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 5, serviceId: 's1' }] } as any, staff)).rejects.toThrow(
      'Selected line is not on the Statement of Work.'
    );

    const { service: mismatched } = harness();
    await expect(mismatched.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's-other' }] } as any, staff)).rejects.toThrow(
      'Selected line is not on the Statement of Work.'
    );
  });

  it('checks whether a position is already live BEFORE checking it is on the SOW', async () => {
    // A locked-checked line the newest version dropped must not make the
    // statement un-issuable.
    const { service, released } = harness({
      liveCharges: [{ kind: 'SERVICE_LINE', sourceIndex: 5 }],
      billableLines: [
        { serviceId: 's1', name: 'PCR', description: '', cost: 350, category: 'Sequencing' },
        { serviceId: 's2', name: 'Gel', description: '', cost: 120, category: 'Sequencing' }
      ]
    });
    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 5, serviceId: 's-anything' }] } as any, staff)).resolves.toBeTruthy();
    expect(released).toEqual([]);
  });

  it('releases nothing when the list is empty, and still issues the statement', async () => {
    const { service, created, released } = harness();
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [] } as any, staff);
    expect(released).toEqual([]);
    expect(created).toHaveLength(1);
  });

  it('issues a $0 statement for a zero-priced release with nothing else on the job, instead of refusing after the charge is already committed', async () => {
    // The SERVICE_LINE row is written before the balance gate runs and cannot
    // be rolled back here. Refusing this statement would leave the row live
    // and the job permanently un-issuable: retrying resends the same
    // already-live position, so `toRelease` would be empty on every later
    // attempt.
    const { service, created, released } = harness({
      billableLines: [{ serviceId: 's1', name: 'Free Consult', description: '', cost: 0, category: 'Consulting' }],
      breakdown: {
        ...defaultBreakdown({}),
        serviceLines: [{ _id: 'c1', serviceId: 's1', label: 'Free Consult', amount: 0, sourceIndex: 0 }],
        chargesToDate: 0,
        paymentsToDate: 0,
        balanceDue: 0,
        confirmedHours: 0
      }
    });
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);
    expect(released).toEqual([{ serviceId: 's1', label: 'Free Consult', amount: 0, sowVersionNumber: 1000, sourceIndex: 0 }]);
    expect(created[0]).toMatchObject({ kind: 'STATEMENT', subtotal: 0, totalCost: 0, balanceDue: 0 });
    expect(created[0].services.map((s: any) => s.serviceId)).toEqual(['s1']);
  });

  it('issues the statement when a release lands against a discount that cancels it to zero charges', async () => {
    // Same shape, discount flavour: a −350 adjustment against a 350 release
    // nets chargesToDate to 0, but a new line was still released this call.
    const { service, created, released } = harness({
      breakdown: {
        ...defaultBreakdown({}),
        serviceLines: [{ _id: 'c1', serviceId: 's1', label: 'PCR', amount: 350, sourceIndex: 0 }],
        adjustments: [{ type: 'DISCOUNT', description: 'Full waiver', reason: undefined, amount: 350, appliedAmount: -350, prorationFactor: 1 }],
        chargesToDate: 0,
        paymentsToDate: 0,
        balanceDue: 0,
        confirmedHours: 0
      }
    });
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);
    expect(released).toEqual([{ serviceId: 's1', label: 'PCR', amount: 350, sowVersionNumber: 1000, sourceIndex: 0 }]);
    expect(created[0]).toMatchObject({ kind: 'STATEMENT', subtotal: 0, totalCost: 0, balanceDue: 0 });
  });
});

const EQUIP = 'Plate reader — 10 hrs/wk x 4 wks (estimate; billed on actual hours)';
const withEquipment = [
  { serviceId: 's1', name: 'PCR', description: '', cost: 350 },
  { serviceId: 'e1', name: 'Plate reader', description: EQUIP, cost: 45 }
];

describe('equipment estimates are never released', () => {
  it('refuses a release naming an equipment line', async () => {
    const { service } = harness({ billableLines: withEquipment });
    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 1, serviceId: 'e1' }] } as any, staff)).rejects.toThrow(
      'Equipment-use lines are billed from bookings, not released.'
    );
  });

  it('still releases the contracted line beside it', async () => {
    const { service, released } = harness({ billableLines: withEquipment });
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);
    expect(released).toHaveLength(1);
    expect(released[0].sourceIndex).toBe(0);
  });

  it('is a no-op, not a refusal, when a legacy equipment charge already holds that position', async () => {
    // A real job billed before this run has a live SERVICE_LINE at an equipment position, and a
    // dialog locks released rows checked. The already-live check runs first, so re-sending it
    // cannot make the statement un-issuable.
    const { service, released } = harness({
      billableLines: withEquipment,
      liveCharges: [{ kind: 'SERVICE_LINE', sourceIndex: 1, amount: 45 }]
    });
    await service.createForJob(
      {
        jobId: 'job-1',
        releaseServiceLines: [
          { sourceIndex: 1, serviceId: 'e1' },
          { sourceIndex: 0, serviceId: 's1' }
        ]
      } as any,
      staff
    );
    expect(released.map((r: any) => r.sourceIndex)).toEqual([0]);
  });

  it('still says "not on the Statement of Work" for a position that does not exist', async () => {
    const { service } = harness({ billableLines: withEquipment });
    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 9, serviceId: 'e1' }] } as any, staff)).rejects.toThrow('Selected line is not on the Statement of Work.');
  });

  it('writes nothing to the ledger, and creates no invoice, when a refused equipment line follows a contracted one in the same call', async () => {
    // Guards createServiceLineCharges staying OUTSIDE the release loop: if it were
    // called per-row as each line is validated, the contracted line ahead of the
    // refused equipment line would already be on the ledger by the time this throws.
    const { service, released, created } = harness({ billableLines: withEquipment });
    await expect(
      service.createForJob(
        {
          jobId: 'job-1',
          releaseServiceLines: [
            { sourceIndex: 0, serviceId: 's1' },
            { sourceIndex: 1, serviceId: 'e1' }
          ]
        } as any,
        staff
      )
    ).rejects.toThrow('Equipment-use lines are billed from bookings, not released.');
    expect(released).toEqual([]);
    expect(created).toHaveLength(0);
  });
});

describe('deposit mode', () => {
  it('writes one DEPOSIT charge and issues the statement', async () => {
    const { service, added, created } = harness({
      breakdown: { ...defaultBreakdown({}), depositLines: [{ _id: 'chg-1', kind: 'DEPOSIT', label: 'Deposit', amount: 500 }], chargesToDate: 500, balanceDue: 500 }
    });
    await service.createForJob({ jobId: 'job-1', deposit: { amount: 500 } } as any, staff);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: 'DEPOSIT', label: 'Deposit', amount: 500 });
    expect(created).toHaveLength(1);
  });

  it('uses the label the caller gave', async () => {
    const { service, added } = harness({ breakdown: { ...defaultBreakdown({}), chargesToDate: 500, balanceDue: 500 } });
    await service.createForJob({ jobId: 'job-1', deposit: { amount: 500, label: '  50% up front  ' } } as any, staff);
    expect(added[0].label).toBe('50% up front');
  });

  it('refuses a deposit that also releases service lines', async () => {
    const { service, added, released } = harness();
    await expect(service.createForJob({ jobId: 'job-1', deposit: { amount: 500 }, releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(
      'A deposit request cannot release service lines.'
    );
    expect(added).toHaveLength(0);
    expect(released).toHaveLength(0);
  });

  it.each([[0], [-5]])('refuses a deposit of %s', async (amount) => {
    const { service } = harness();
    await expect(service.createForJob({ jobId: 'job-1', deposit: { amount } } as any, staff)).rejects.toThrow('A deposit must be greater than zero.');
  });

  it('refuses a deposit carrying custom lines', async () => {
    const { service } = harness();
    await expect(service.createForJob({ jobId: 'job-1', deposit: { amount: 500 }, customLines: [{ label: 'Courier', amount: 25 }] } as any, staff)).rejects.toThrow(
      'A deposit request cannot carry other lines.'
    );
  });

  it('refuses a deposit once service lines have been released', async () => {
    const { service, added, created } = harness({ liveCharges: [{ kind: 'SERVICE_LINE', sourceIndex: 0, amount: 350 }] });
    await expect(service.createForJob({ jobId: 'job-1', deposit: { amount: 500 } } as any, staff)).rejects.toThrow('A deposit cannot be requested once service lines have been released.');
    expect(added).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  // A deposit is money owed before the SOW is signed — the countersign gate
  // exists to keep the lab from billing an unsigned contract, and a deposit is
  // not that: it must not be blocked by a SOW that is merely SENT, or absent.
  it('issues a STATEMENT carrying the deposit when the SOW is only SENT', async () => {
    const { service, added, created } = harness({
      activeStatus: 'SENT',
      breakdown: { ...defaultBreakdown({}), depositLines: [{ _id: 'chg-1', kind: 'DEPOSIT', label: 'Deposit', amount: 500 }], chargesToDate: 500, balanceDue: 500 }
    });
    await service.createForJob({ jobId: 'job-1', deposit: { amount: 500 } } as any, staff);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: 'DEPOSIT', label: 'Deposit', amount: 500 });
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('STATEMENT');
    // Not FINAL, so the document carries no version number.
    expect(created[0].sowVersionNumber).toBeUndefined();
  });

  it('issues a STATEMENT carrying the deposit when the job has no SOW at all', async () => {
    const { service, added, created } = harness({
      hasSow: false,
      breakdown: { ...defaultBreakdown({}), depositLines: [{ _id: 'chg-1', kind: 'DEPOSIT', label: 'Deposit', amount: 500 }], chargesToDate: 500, balanceDue: 500 }
    });
    await service.createForJob({ jobId: 'job-1', deposit: { amount: 500 } } as any, staff);
    expect(added).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('STATEMENT');
    expect(created[0].sowVersionNumber).toBeUndefined();
    expect(created[0].billedToName).toBe('Client');
  });

  it('still refuses a non-deposit call on a SENT SOW with the countersign message', async () => {
    const { service, added, created } = harness({ activeStatus: 'SENT' });
    await expect(service.createForJob({ jobId: 'job-1' } as any, staff)).rejects.toThrow('Cannot generate an invoice until the Statement of Work is countersigned.');
    expect(added).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
});

describe('custom lines', () => {
  it('writes each one as a CUSTOM charge before the balance is read', async () => {
    const { service, added } = harness({ breakdown: { ...defaultBreakdown({}), chargesToDate: 375, balanceDue: 375 } });
    await service.createForJob(
      {
        jobId: 'job-1',
        customLines: [
          { label: 'Courier', amount: 25, note: 'Overnight' },
          { label: 'Goodwill', amount: -50 }
        ]
      } as any,
      staff
    );
    expect(added.map((c: any) => [c.kind, c.label, c.amount, c.note])).toEqual([
      ['CUSTOM', 'Courier', 25, 'Overnight'],
      ['CUSTOM', 'Goodwill', -50, undefined]
    ]);
  });

  it('writes nothing at all when one of them is invalid', async () => {
    const { service, added } = harness();
    await expect(
      service.createForJob(
        {
          jobId: 'job-1',
          customLines: [
            { label: 'Courier', amount: 25 },
            { label: 'Bad', amount: 0 }
          ]
        } as any,
        staff
      )
    ).rejects.toThrow('A charge amount cannot be zero.');
    expect(added).toHaveLength(0);
  });

  it('writes nothing at all when one of them rounds away to zero cents', async () => {
    // The charge service rounds to cents before its own zero check, so a
    // sub-cent line refuses there — after the lines before it are already on
    // the ledger. This gate rounds the same way, so it refuses first.
    const { service, added } = harness();
    await expect(
      service.createForJob(
        {
          jobId: 'job-1',
          customLines: [
            { label: 'Courier', amount: 25 },
            { label: 'Dust', amount: 0.004 }
          ]
        } as any,
        staff
      )
    ).rejects.toThrow('A charge amount cannot be zero.');
    expect(added).toHaveLength(0);
  });

  it('refuses a line with no label', async () => {
    const { service } = harness();
    await expect(service.createForJob({ jobId: 'job-1', customLines: [{ label: '   ', amount: 25 }] } as any, staff)).rejects.toThrow('A label is required for a charge.');
  });

  it('issues a statement for a single negative custom line even though it charges nothing', async () => {
    // Behaviour 11's last sentence: a call that changes the ledger always issues. A deposit
    // cannot exercise this — deposits are positive — so a credit is the case that matters.
    const { service, created } = harness({ breakdown: { ...defaultBreakdown({}), chargesToDate: -50, paymentsToDate: 0, balanceDue: -50, confirmedHours: 0 } });
    await service.createForJob({ jobId: 'job-1', customLines: [{ label: 'Goodwill', amount: -50 }] } as any, staff);
    expect(created).toHaveLength(1);
  });

  it('still refuses an empty statement when the call changed nothing', async () => {
    const { service } = harness({ breakdown: { ...defaultBreakdown({}), chargesToDate: 0, paymentsToDate: 0, balanceDue: 0, confirmedHours: 0 } });
    await expect(service.createForJob({ jobId: 'job-1' } as any, staff)).rejects.toThrow('Nothing to invoice yet.');
  });

  it('carries the note onto the document', async () => {
    const { service, created } = harness({
      breakdown: { ...defaultBreakdown({}), customLines: [{ _id: 'chg-9', kind: 'CUSTOM', label: 'Courier', amount: 25, note: 'Overnight' }], depositLines: [] }
    });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].customLines[0]).toMatchObject({ label: 'Courier', amount: 25, note: 'Overnight' });
  });
});

describe('the document', () => {
  it('is a STATEMENT', async () => {
    const { service, created } = harness();
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].kind).toBe('STATEMENT');
  });

  it('takes the next number in the job’s own series, counting voided documents', async () => {
    const { service, created } = harness({ existingInvoices: [{ _id: 'a' }, { _id: 'b', voidedAt: new Date() }] });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].invoiceNumber).toBe('04217-003');
  });

  it('lists every live service line in position order, at its released amount', async () => {
    const { service, created } = harness({
      breakdown: {
        ...defaultBreakdown({}),
        serviceLines: [
          { _id: 'c2', serviceId: 's2', label: 'Gel', amount: 120, sourceIndex: 1 },
          { _id: 'c1', serviceId: 's1', label: 'PCR', amount: 350, sourceIndex: 0 }
        ]
      }
    });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].services.map((s: any) => [s.serviceId, s.cost])).toEqual([
      ['s1', 350],
      ['s2', 120]
    ]);
  });

  it('carries the adjustments at the balance’s proration factor', async () => {
    const adjustments = [{ type: 'DISCOUNT', description: 'Academic', reason: undefined, amount: 40, appliedAmount: -30, prorationFactor: 0.75 }];
    const { service, created } = harness({ breakdown: { ...defaultBreakdown({}), adjustments } });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].adjustments).toEqual(adjustments);
  });

  it('lists the confirmed bookings as equipment lines', async () => {
    const booking = {
      _id: 'bk-1',
      inventoryName: 'Bioanalyzer',
      notes: 'Op notes',
      startTime: new Date('2026-03-01T09:00:00Z'),
      endTime: new Date('2026-03-01T11:00:00Z'),
      actualHours: 2,
      rateSnapshot: 40,
      cost: 80,
      usageConfirmedAt: new Date('2026-03-02T10:00:00Z')
    };
    const { service, created } = harness({ breakdown: { ...defaultBreakdown({}), bookings: [booking] } });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].equipmentLines).toEqual([
      {
        bookingId: 'bk-1',
        itemName: 'Bioanalyzer',
        operationLabel: 'Op notes',
        startTime: booking.startTime,
        endTime: booking.endTime,
        actualHours: 2,
        rate: 40,
        cost: 80,
        confirmedAt: booking.usageConfirmedAt
      }
    ]);
  });

  it('lists live custom charges and, when they have not dropped off, the deposits', async () => {
    const { service, created } = harness({
      breakdown: {
        ...defaultBreakdown({}),
        customLines: [{ _id: 'chg-1', kind: 'CUSTOM', label: 'Courier', amount: 25 }],
        depositLines: [{ _id: 'chg-2', kind: 'DEPOSIT', label: 'Deposit', amount: 500 }]
      }
    });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].customLines).toEqual([
      { chargeId: 'chg-1', kind: 'CUSTOM', label: 'Courier', amount: 25 },
      { chargeId: 'chg-2', kind: 'DEPOSIT', label: 'Deposit', amount: 500 }
    ]);
  });

  it('omits the deposits once a service line has been released', async () => {
    const { service, created } = harness({
      breakdown: { ...defaultBreakdown({}), customLines: [{ _id: 'chg-1', kind: 'CUSTOM', label: 'Courier', amount: 25 }], depositLines: [] }
    });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].customLines).toEqual([{ chargeId: 'chg-1', kind: 'CUSTOM', label: 'Courier', amount: 25 }]);
  });

  it('states charges, payments and balance, with the total being what is owed now', async () => {
    const { service, created } = harness({ breakdown: { ...defaultBreakdown({}), chargesToDate: 500, paymentsToDate: 200, balanceDue: 300 } });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0]).toMatchObject({ subtotal: 500, paymentsToDate: 200, balanceDue: 300, totalCost: 300 });
  });

  it('defaults the due date to thirty days after issue', async () => {
    const { service, created } = harness();
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    const invoice = created[0];
    expect(invoice.dueDate.getTime() - invoice.invoiceDate.getTime()).toBe(30 * 24 * 3_600_000);
  });

  it('takes the due date the caller gave instead', async () => {
    const { service, created } = harness();
    const dueDate = new Date('2026-05-01T00:00:00Z');
    await service.createForJob({ jobId: 'job-1', dueDate } as any, staff);
    expect(created[0].dueDate).toEqual(dueDate);
  });

  it('bills to the SOW’s contact and records the version in force', async () => {
    const { service, created } = harness();
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0]).toMatchObject({ billedToName: 'Dr Client', billedToEmail: 'client@bu.edu', billedToAddress: '1 Main St', sowVersionNumber: 1000, createdBy: 'tech@bu.edu' });
  });

  it('records no billingWarnings — there is no cross-invoice check any more', async () => {
    const { service, created } = harness();
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].billingWarnings).toBeUndefined();
  });
});

describe('the notification', () => {
  it('tells the job owner what is due and by when', async () => {
    const { service, dispatched } = harness({ breakdown: { ...defaultBreakdown({}), chargesToDate: 150, paymentsToDate: 0, balanceDue: 150 } });
    const dueDate = new Date('2026-04-09T00:00:00Z');
    await service.createForJob({ jobId: 'job-1', dueDate } as any, staff);
    expect(dispatched[0]).toMatchObject({ eventType: 'INVOICE_ISSUED' });
    expect(dispatched[0].message).toContain('Amount due: $150.00');
    expect(dispatched[0].message).toContain('Payment is due by 2026-04-09');
  });
});
