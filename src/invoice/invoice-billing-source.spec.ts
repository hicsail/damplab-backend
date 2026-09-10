import { InvoiceService } from './invoice.service';
import { User } from '../auth/user.interface';

/**
 * What a statement bills from.
 *
 * A SOW version is a static record; `sow.services` is not — the workflow sync
 * overwrites it whenever the job spec changes. Releasing a line reads the
 * version in force with the customer, never the live billing core, which is
 * the exact failure the static-record rule exists to prevent.
 */

const staff = { realm_access: { roles: ['damplab-staff'] }, email: 'tech@bu.edu' } as unknown as User;

interface HarnessOptions {
  /** Lifecycle status of the version in force. FINAL unless a test is about the gate. */
  activeStatus?: string | null;
  /** The SOW's version history, which the old gate used to read; kept for shape only. */
  versionHistory?: any[];
  /** What the job currently prices these lines at — deliberately different from the document. */
  liveServices?: any[];
  /** The version in force with the customer, or null for a legacy pre-versioning SOW. */
  activeInputs?: any | null;
  /** Version number of the document in force, mirrored onto invoices billed from it. */
  activeVersionNumber?: number;
  /** What the job says today — deliberately separable from what the version froze. */
  jobCustomerCategory?: string;
  /** Positions already released before this call, as `liveByJobId` would report. */
  liveCharges?: any[];
}

function harness(opts: HarnessOptions = {}): { service: InvoiceService; created: any[]; released: any[] } {
  const created: any[] = [];
  const released: any[] = [];

  const invoiceModel: any = {
    countDocuments: () => ({ exec: async (): Promise<number> => 0 }),
    find: () => ({ exec: async (): Promise<any[]> => [] }),
    create: async (doc: any): Promise<any> => {
      created.push(doc);
      return doc;
    }
  };

  const jobService: any = { findById: async () => ({ _id: 'job-1', jobId: '04217', name: 'Test job', customerCategory: opts.jobCustomerCategory }) };

  // FINAL by default: a statement bills a countersigned SOW, so that is the
  // shape every test here starts from unless it is specifically about the gate.
  const activeVersion = (): any =>
    opts.activeInputs === null
      ? null
      : {
          versionNumber: opts.activeVersionNumber ?? 1000,
          status: opts.activeStatus ?? 'FINAL',
          inputs: opts.activeInputs ?? { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [] }
        };
  const liveServices = (): any[] => opts.liveServices ?? [{ serviceId: 's1', name: 'PCR', cost: 420 }];

  const sowService: any = {
    findByJobId: async () => ({
      _id: 'sow-1',
      services: liveServices(),
      pricing: { baseCost: 420, adjustments: [{ type: 'DISCOUNT', description: 'Later discount', amount: 100 }], totalCost: 320 }
    }),
    // The real one prefers the version in force and falls back to the billing
    // core; releasing and the staff dialog both read it, which is what makes a
    // line's position mean the same thing on both sides.
    billableServiceLines: async (): Promise<any[]> => activeVersion()?.inputs?.services ?? liveServices()
  };

  const sowVersionService: any = {
    getActiveVersion: async () => activeVersion(),
    listVersions: async (): Promise<any[]> => opts.versionHistory ?? [activeVersion()].filter(Boolean)
  };

  const charges: any = {
    liveByJobId: async () => opts.liveCharges ?? [],
    createServiceLineCharges: async (jobId: string, rows: any[]) => {
      released.push(...rows);
      return rows;
    }
  };

  // Reactive: what a statement states is whatever this call released, plus
  // whatever was already live — the same ledger `createForJob` reads after
  // releasing onto it. Kept simple (service lines and adjustments only; no
  // bookings, custom charges or deposits) because this file is about the
  // billing SOURCE, not the whole breakdown, which has its own spec.
  const balances: any = {
    chargeBreakdown: async () => {
      const already = (opts.liveCharges ?? []).filter((c: any) => String(c.kind) === 'SERVICE_LINE');
      const serviceLines = [...already, ...released];
      const adjustments = activeVersion()?.status === 'FINAL' ? computeAdjustments(activeVersion()) : [];
      const serviceCharges = round2(serviceLines.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0));
      const adjustmentCharges = round2(adjustments.reduce((sum: number, a: any) => sum + (Number(a.appliedAmount) || 0), 0));
      const chargesToDate = round2(serviceCharges + adjustmentCharges);
      return {
        jobId: 'job-1',
        serviceLines,
        customLines: [],
        depositLines: [],
        bookings: [],
        adjustments,
        prorationFactor: 1,
        chargesToDate,
        paymentsToDate: 0,
        balanceDue: chargesToDate,
        confirmedHours: 0,
        unconfirmedBookings: 0
      };
    },
    confirmedBookings: async () => []
  };

  function computeAdjustments(active: any): any[] {
    const rawAdjustments: any[] = active?.inputs?.adjustments ?? [];
    // Prorate against the version's own base, matching JobBalanceService.
    const base = round2((active?.inputs?.services ?? []).reduce((sum: number, s: any) => sum + (Number(s.cost) || 0), 0));
    const releasedTotal = round2([...(opts.liveCharges ?? []).filter((c: any) => String(c.kind) === 'SERVICE_LINE'), ...released].reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0));
    const factor = base > 0 ? Math.min(1, releasedTotal / base) : 0;
    return rawAdjustments.map((a: any) => {
      const applied = a.type === 'SPECIAL_TERM' ? 0 : round2(Number(a.amount) || 0) * factor * (a.type === 'DISCOUNT' ? -1 : 1);
      return { ...a, appliedAmount: round2(applied), prorationFactor: factor };
    });
  }

  function round2(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  const dispatch: any = { dispatch: () => undefined };

  return { service: new InvoiceService(invoiceModel, jobService, sowService, sowVersionService, charges, balances, dispatch), created, released };
}

describe('an invoice bills a countersigned SOW, or nothing', () => {
  it('refuses a SOW that has been sent but not countersigned', async () => {
    const { service, created } = harness({ activeStatus: 'SENT' });

    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(
      'Cannot generate an invoice until the Statement of Work is countersigned.'
    );
    expect(created).toEqual([]);
  });

  it('refuses a SOW the customer has signed but the lab has not', async () => {
    const { service } = harness({ activeStatus: 'SIGNED' });

    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(
      'Cannot generate an invoice until the Statement of Work is countersigned.'
    );
  });

  it('refuses a cancelled SOW', async () => {
    const { service } = harness({ activeStatus: 'CANCELLED' });

    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(
      'Cannot generate an invoice until the Statement of Work is countersigned.'
    );
  });

  it('refuses a SOW that was countersigned and then taken back', async () => {
    // Withdrawing zeroes activeVersionNumber, which looks identical to never
    // having issued anything — and the statement is refused either way, in the
    // same words.
    const { service } = harness({
      activeInputs: null,
      versionHistory: [{ versionNumber: 1001, status: 'FINAL' }]
    });

    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(
      'Cannot generate an invoice until the Statement of Work is countersigned.'
    );
  });

  it('lets a countersigned SOW through unchanged', async () => {
    const { service, created } = harness();

    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);

    expect(created).toHaveLength(1);
    expect(created[0].sowVersionNumber).toBe(1000);
  });
});

describe('the category an invoice states', () => {
  it('records the category the lines were billed under, not the job’s current one', async () => {
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [], customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' }
    });

    // The harness job carries no category at all; the version does. Re-categorising
    // a job must not rewrite what an already-issued invoice says it charged.
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);

    expect(created[0].customerCategory).toBe('EXTERNAL_CUSTOMER_ACADEMIC');
  });

  it('prefers the frozen category even when the job now says something else', async () => {
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [], customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' },
      jobCustomerCategory: 'INTERNAL_CUSTOMERS'
    });

    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);

    // INTERNAL vs EXTERNAL is not cosmetic: it drives the invoice header and the
    // payment instructions, so this is what stops a re-categorised job telling an
    // external customer to file an internal ISR.
    expect(created[0].customerCategory).toBe('EXTERNAL_CUSTOMER_ACADEMIC');
  });

  it('falls back to the job for a version issued before the category was recorded', async () => {
    // `deriveInputs` stores the category now, but versions written before it did
    // carry none — and those are countersigned documents that must stay
    // invoiceable, so the job is read rather than the invoice refused.
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [] },
      jobCustomerCategory: 'INTERNAL_CUSTOMERS'
    });

    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);

    expect(created[0].customerCategory).toBe('INTERNAL_CUSTOMERS');
  });
});

describe('invoice billing source', () => {
  it('bills the signed figure, not the job’s current one', async () => {
    const { service, created } = harness();

    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);

    // The job now says $420; the version in force says $350.
    expect(created[0].services[0].cost).toBe(350);
    expect(created[0].subtotal).toBe(350);
  });

  it('does not apply an adjustment the customer never agreed to', async () => {
    const { service, created } = harness();

    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);

    // sow.pricing carries a $100 discount added after the version was issued;
    // the version in force (the default fixture) carries none.
    expect(created[0].adjustments).toEqual([]);
    expect(created[0].totalCost).toBe(350);
  });

  it('applies the adjustments the version in force does carry', async () => {
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 50 }] }
    });

    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);

    expect(created[0].adjustments[0]).toMatchObject({ type: 'DISCOUNT', appliedAmount: -50 });
    expect(created[0].totalCost).toBe(300);
  });

  it('prorates against the version’s base, so a part-release takes its share of the discount', async () => {
    const { service, created } = harness({
      activeInputs: {
        services: [
          { serviceId: 's1', name: 'PCR', cost: 300 },
          { serviceId: 's2', name: 'Gel', cost: 100 }
        ],
        adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 40 }]
      }
    });

    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);

    // 300 of a 400 base = 0.75 of the $40 discount.
    expect(created[0].adjustments[0].appliedAmount).toBe(-30);
    expect(created[0].totalCost).toBe(270);
  });

  it('refuses a legacy SOW with no version at all, rather than billing the live core', async () => {
    // This used to invoice happily off `sow.services` — $420 and a $100 discount
    // the customer never saw, from a billing core the workflow sync rewrites. The
    // countersign gate is what stops it.
    const { service, created } = harness({ activeInputs: null, versionHistory: [] });

    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(
      'Cannot generate an invoice until the Statement of Work is countersigned.'
    );
    expect(created).toEqual([]);
  });

  it('refuses a non-staff caller', async () => {
    const { service } = harness();
    const customer = { realm_access: { roles: [] } } as unknown as User;

    await expect(service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, customer)).rejects.toThrow();
  });
});

describe('the pricing basis an invoice states', () => {
  // The SOW's Fee Schedule prints "$unitCost x multiplier = $cost" from these
  // three fields. The invoice snapshot used to keep only `cost`, so a line the
  // SOW explained as "$50.00 x 4" reached the invoice as an unexplained $200.
  it('carries the unit price, multiplier and run count off the version', async () => {
    const { service, created } = harness({
      activeInputs: {
        services: [{ serviceId: 's1', name: 'Sequencing', cost: 200, unitCost: 50, multiplier: 4, runCount: 4, category: 'molecular-biology' }],
        adjustments: []
      }
    });

    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);

    expect(created[0].services[0]).toEqual(expect.objectContaining({ cost: 200, unitCost: 50, multiplier: 4, runCount: 4, category: 'molecular-biology' }));
  });

  it('leaves the breakdown undefined on a legacy line rather than inventing a zero', async () => {
    // A unit price of 0 is legitimate, so "absent" and "free" must stay
    // distinguishable — renderers fall back to the bare total on undefined.
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [] }
    });

    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);

    const line = created[0].services[0];
    expect({ cost: line.cost, unitCost: line.unitCost, multiplier: line.multiplier, runCount: line.runCount }).toEqual({
      cost: 350,
      unitCost: undefined,
      multiplier: undefined,
      runCount: undefined
    });
  });
});

describe('the itemised breakdown behind a parameter-priced line', () => {
  it("carries the SOW line's pricing details onto the invoice", async () => {
    const details = [
      { label: 'Instrument: Bioanalyzer', quantity: 1, unitPrice: 100, total: 100 },
      { label: 'Hours in use', quantity: 3, unitPrice: 40, total: 120 }
    ];
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'Equipment use', cost: 220, unitCost: 220, multiplier: 1, pricingDetails: details }], adjustments: [] }
    });
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);
    expect(created[0].services[0].pricingDetails).toEqual(details);
  });

  it('leaves it undefined on a line with nothing to itemise, rather than an empty list', async () => {
    // Same rule unitCost and multiplier already follow: absent must stay
    // distinguishable from "itemised, and it came to nothing".
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350, pricingDetails: [] }], adjustments: [] }
    });
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [{ sourceIndex: 0, serviceId: 's1' }] } as any, staff);
    expect(created[0].services[0].pricingDetails).toBeUndefined();
  });
});
