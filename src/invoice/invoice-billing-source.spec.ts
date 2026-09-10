import { InvoiceService } from './invoice.service';
import { User } from '../auth/user.interface';

/**
 * What an invoice bills from.
 *
 * A SOW version is a static record; `sow.services` is not — the workflow sync
 * overwrites it whenever the job spec changes. Invoicing from the billing core
 * would therefore bill a figure no signed document ever stated, which is the
 * exact failure the static-record rule exists to prevent. Invoices read the
 * version in force with the customer.
 */

const staff = { realm_access: { roles: ['damplab-staff'] }, email: 'tech@bu.edu' } as unknown as User;

interface HarnessOptions {
  /** Lifecycle status of the version in force. FINAL unless a test is about the gate. */
  activeStatus?: string | null;
  /** The SOW's version history, which the gate reads to tell "withdrawn" from "never issued". */
  versionHistory?: any[];
  /** What the job currently prices these lines at — deliberately different from the document. */
  liveServices?: any[];
  livePricing?: any;
  /** The version in force with the customer, or null for a legacy pre-versioning SOW. */
  activeInputs?: any | null;
  /** Version number of the document in force, mirrored onto invoices billed from it. */
  activeVersionNumber?: number;
  /** Invoices already generated for this job, which the double-billing check reads. */
  existingInvoices?: any[];
  /** What the job says today — deliberately separable from what the version froze. */
  jobCustomerCategory?: string;
}

function harness(opts: HarnessOptions = {}): { service: InvoiceService; created: any[] } {
  const created: any[] = [];
  const existing = opts.existingInvoices ?? [];

  const invoiceModel: any = {
    countDocuments: () => ({ exec: async (): Promise<number> => existing.length }),
    // Honours the `voidedAt: null` half of the filter, because that is what makes
    // voiding release a line: a harness that returned voided invoices anyway would
    // let the guard look correct while the real query had stopped matching.
    find: (filter: any = {}) => ({
      exec: async (): Promise<any[]> => (Object.prototype.hasOwnProperty.call(filter, 'voidedAt') ? existing.filter((inv: any) => inv.voidedAt == null) : existing)
    }),
    create: async (doc: any): Promise<any> => {
      created.push(doc);
      return doc;
    }
  };

  const jobService: any = { findById: async () => ({ _id: 'job-1', jobId: '04217', name: 'Test job', customerCategory: opts.jobCustomerCategory }) };

  // FINAL by default: an invoice bills a countersigned SOW, so that is the shape
  // every test here starts from unless it is specifically about the gate.
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
      pricing: opts.livePricing ?? { baseCost: 420, adjustments: [{ type: 'DISCOUNT', description: 'Later discount', amount: 100 }], totalCost: 320 }
    }),
    // The real one prefers the version in force and falls back to the billing
    // core; the invoice and the staff dialog both read it, which is what makes
    // a line's position mean the same thing on both sides.
    billableServiceLines: async (): Promise<any[]> => activeVersion()?.inputs?.services ?? liveServices()
  };

  const sowVersionService: any = {
    getActiveVersion: async () => activeVersion(),
    // Defaults to "the active version is the only one", which is what makes a
    // version-less SOW read as legacy rather than as withdrawn.
    listVersions: async (): Promise<any[]> => opts.versionHistory ?? [activeVersion()].filter(Boolean)
  };

  const balances: any = { balance: async () => ({ jobId: 'job-1', chargesToDate: 0, paymentsToDate: 0, balanceDue: 0, confirmedHours: 0, unconfirmedBookings: 0 }), confirmedBookings: async () => [] };
  const dispatch: any = { dispatch: () => undefined };

  return { service: new InvoiceService(invoiceModel, jobService, sowService, sowVersionService, balances, dispatch), created };
}

describe('an invoice bills a countersigned SOW, or nothing', () => {
  it('refuses a SOW that has been sent but not countersigned', async () => {
    const { service, created } = harness({ activeStatus: 'SENT' });

    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/not been countersigned yet/i);
    expect(created).toEqual([]);
  });

  it('refuses a SOW the customer has signed but the lab has not', async () => {
    const { service } = harness({ activeStatus: 'SIGNED' });

    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/not been countersigned yet/i);
  });

  it('refuses a cancelled SOW', async () => {
    const { service } = harness({ activeStatus: 'CANCELLED' });

    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/cancelled/i);
  });

  it('says "withdrawn" for a SOW that was countersigned and then taken back', async () => {
    // Withdrawing zeroes activeVersionNumber, which looks identical to never
    // having issued anything — and staff who countersigned it will say so.
    const { service } = harness({
      activeInputs: null,
      versionHistory: [{ versionNumber: 1001, status: 'FINAL' }]
    });

    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/withdrawn/i);
  });

  it('lets a countersigned SOW through unchanged', async () => {
    const { service, created } = harness();

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

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
    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    expect(created[0].customerCategory).toBe('EXTERNAL_CUSTOMER_ACADEMIC');
  });

  it('prefers the frozen category even when the job now says something else', async () => {
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [], customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' },
      jobCustomerCategory: 'INTERNAL_CUSTOMERS'
    });

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

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

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    expect(created[0].customerCategory).toBe('INTERNAL_CUSTOMERS');
  });
});

describe('invoice billing source', () => {
  it('bills the signed figure, not the job’s current one', async () => {
    const { service, created } = harness();

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    // The job now says $420; the version in force says $350.
    expect(created[0].services[0].cost).toBe(350);
    expect(created[0].subtotal).toBe(350);
  });

  it('does not apply an adjustment the customer never agreed to', async () => {
    const { service, created } = harness();

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    // sow.pricing carries a $100 discount added after the version was issued.
    expect(created[0].adjustments).toEqual([]);
    expect(created[0].totalCost).toBe(350);
  });

  it('applies the adjustments the version in force does carry', async () => {
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 50 }] }
    });

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    expect(created[0].adjustments[0]).toMatchObject({ type: 'DISCOUNT', appliedAmount: -50 });
    expect(created[0].totalCost).toBe(300);
  });

  it('prorates against the version’s base, so a part-invoice takes its share of the discount', async () => {
    const { service, created } = harness({
      activeInputs: {
        services: [
          { serviceId: 's1', name: 'PCR', cost: 300 },
          { serviceId: 's2', name: 'Gel', cost: 100 }
        ],
        adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 40 }]
      }
    });

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    // 300 of a 400 base = 0.75 of the $40 discount.
    expect(created[0].adjustments[0].appliedAmount).toBe(-30);
    expect(created[0].totalCost).toBe(270);
  });

  it('refuses a legacy SOW with no version at all, rather than billing the live core', async () => {
    // This used to invoice happily off `sow.services` — $420 and a $100 discount
    // the customer never saw, from a billing core the workflow sync rewrites. The
    // countersign gate is what stops it; the numbers above are what it was billing.
    const { service, created } = harness({ activeInputs: null, versionHistory: [] });

    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/predates document versioning/i);
    expect(created).toEqual([]);
  });

  it('refuses a non-staff caller', async () => {
    const { service } = harness();
    const customer = { realm_access: { roles: [] } } as unknown as User;

    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, customer)).rejects.toThrow();
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

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    expect(created[0].services[0]).toEqual(expect.objectContaining({ cost: 200, unitCost: 50, multiplier: 4, runCount: 4, category: 'molecular-biology' }));
  });

  it('leaves the breakdown undefined on a legacy line rather than inventing a zero', async () => {
    // A unit price of 0 is legitimate, so "absent" and "free" must stay
    // distinguishable — renderers fall back to the bare total on undefined.
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [] }
    });

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    const line = created[0].services[0];
    expect({ cost: line.cost, unitCost: line.unitCost, multiplier: line.multiplier, runCount: line.runCount }).toEqual({
      cost: 350,
      unitCost: undefined,
      multiplier: undefined,
      runCount: undefined
    });
  });
});

/**
 * The same catalog service used twice.
 *
 * Two PCR nodes with different parameters are two lines with different prices
 * and one shared `serviceId`. Selection used to resolve through a Map keyed on
 * that id, so the second line overwrote the first: billing both charged the
 * last one twice and the other never appeared.
 */
describe('a job that uses the same service more than once', () => {
  const twoPcrLines = {
    activeInputs: {
      services: [
        { serviceId: 's1', name: 'PCR', description: 'First run', cost: 100, unitCost: 100, multiplier: 1 },
        { serviceId: 's1', name: 'PCR', description: 'Second run', cost: 250, unitCost: 125, multiplier: 2 }
      ],
      adjustments: []
    }
  };

  it('bills both lines at their own prices', async () => {
    const { service, created } = harness(twoPcrLines);

    await service.createForJob(
      {
        jobId: 'job-1',
        services: [
          { index: 0, serviceId: 's1' },
          { index: 1, serviceId: 's1' }
        ]
      } as any,
      staff
    );

    expect(created[0].services.map((s: any) => s.cost)).toEqual([100, 250]);
    expect(created[0].subtotal).toBe(350);
  });

  it('can bill just one of them, and bills the one that was picked', async () => {
    // Previously impossible: both lines shared a key, so a single id resolved to
    // whichever the Map had kept — always the second.
    const { service, created } = harness(twoPcrLines);

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    expect(created[0].services).toHaveLength(1);
    expect({ description: created[0].services[0].description, cost: created[0].services[0].cost }).toEqual({ description: 'First run', cost: 100 });
    expect(created[0].subtotal).toBe(100);
  });

  it('still resolves the legacy id contract as a multiset, one line per entry', async () => {
    const { service, created } = harness(twoPcrLines);

    await service.createForJob({ jobId: 'job-1', serviceIds: ['s1', 's1'] } as any, staff);

    expect(created[0].services.map((s: any) => s.cost)).toEqual([100, 250]);
    expect(created[0].subtotal).toBe(350);
  });
});

describe('selections the invoice refuses rather than silently mis-billing', () => {
  const oneLine = { activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [] } };

  it('refuses a position that no longer exists instead of dropping it', async () => {
    // The old code ran the misses through filter(Boolean): an out-of-range pick
    // simply vanished, and the invoice came out short with no indication.
    const { service, created } = harness(oneLine);
    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 5, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/no longer part of this Statement of Work/);
    expect(created).toEqual([]);
  });

  it('refuses when the line at that position is a different service now', async () => {
    const { service, created } = harness(oneLine);
    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's-other' }] } as any, staff)).rejects.toThrow(/changed while the invoice was being prepared/);
    expect(created).toEqual([]);
  });

  it('refuses a legacy id with no line to match, rather than billing nothing for it', async () => {
    const { service } = harness(oneLine);
    await expect(service.createForJob({ jobId: 'job-1', serviceIds: ['s1', 's1'] } as any, staff)).rejects.toThrow(/No unbilled service line matching s1/);
  });

  it('refuses an empty selection, and refuses both contracts at once', async () => {
    const { service } = harness(oneLine);
    await expect(service.createForJob({ jobId: 'job-1' } as any, staff)).rejects.toThrow(/at least one service/);
    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }], serviceIds: ['s1'] } as any, staff)).rejects.toThrow(/not both/);
  });
});

describe('a job invoiced more than once', () => {
  const twoLines = {
    services: [
      { serviceId: 's1', name: 'PCR', cost: 300 },
      { serviceId: 's2', name: 'Sequencing', cost: 100 }
    ],
    adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 40 }]
  };

  /** An invoice as the service now writes them: positions recorded, version stamped. */
  function priorInvoice(indexes: number[], over: Record<string, unknown> = {}): any {
    return {
      _id: 'inv-1',
      invoiceNumber: '04217-001',
      sowVersionNumber: 1000,
      services: indexes.map((sourceIndex) => ({ serviceId: `s${sourceIndex + 1}`, sourceIndex })),
      ...over
    };
  }

  it('refuses to bill a line that an earlier invoice already covered', async () => {
    const { service } = harness({ activeInputs: twoLines, existingInvoices: [priorInvoice([0])] });
    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/already been invoiced/i);
  });

  it('names the service and the invoice it is already on', async () => {
    const { service } = harness({ activeInputs: twoLines, existingInvoices: [priorInvoice([0])] });
    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/PCR.*04217-001/);
  });

  it('lets the second invoice bill the lines the first did not', async () => {
    const { service, created } = harness({ activeInputs: twoLines, existingInvoices: [priorInvoice([0])] });
    await service.createForJob({ jobId: 'job-1', services: [{ index: 1, serviceId: 's2' }] } as any, staff);
    expect(created[0].subtotal).toBe(100);
    expect(created[0].services[0].sourceIndex).toBe(1);
  });

  it('splits a job across two invoices that together sum to the SOW total', async () => {
    // The promise the proration comment makes, now that nothing can bill a line
    // twice: 300 - 30 and 100 - 10 against a 400 base and a 40 discount.
    const first = harness({ activeInputs: twoLines });
    await first.service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    const second = harness({ activeInputs: twoLines, existingInvoices: [priorInvoice([0])] });
    await second.service.createForJob({ jobId: 'job-1', services: [{ index: 1, serviceId: 's2' }] } as any, staff);

    expect(first.created[0].totalCost + second.created[0].totalCost).toBe(360);
  });

  it('warns rather than asserting when an earlier invoice predates line tracking', async () => {
    const legacy = priorInvoice([0]);
    legacy.services = [{ serviceId: 's1' }];
    const { service, created } = harness({ activeInputs: twoLines, existingInvoices: [legacy] });
    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);
    expect(created[0].billingWarnings).toEqual([expect.stringMatching(/predates line tracking/i)]);
  });

  it('warns rather than asserting when an earlier invoice came off a different version', async () => {
    const { service, created } = harness({
      activeInputs: twoLines,
      activeVersionNumber: 2000,
      existingInvoices: [priorInvoice([0])]
    });
    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);
    expect(created[0].billingWarnings).toEqual([expect.stringMatching(/different version/i)]);
  });

  it('records no warning when every earlier invoice could be checked', async () => {
    const { service, created } = harness({ activeInputs: twoLines, existingInvoices: [priorInvoice([0])] });
    await service.createForJob({ jobId: 'job-1', services: [{ index: 1, serviceId: 's2' }] } as any, staff);
    expect(created[0].billingWarnings).toBeUndefined();
    expect(created[0].sowVersionNumber).toBe(1000);
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
    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);
    expect(created[0].services[0].pricingDetails).toEqual(details);
  });

  it('leaves it undefined on a line with nothing to itemise, rather than an empty list', async () => {
    // Same rule unitCost and multiplier already follow: absent must stay
    // distinguishable from "itemised, and it came to nothing".
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350, pricingDetails: [] }], adjustments: [] }
    });
    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);
    expect(created[0].services[0].pricingDetails).toBeUndefined();
  });
});

describe('equipment invoices and the billed-positions guard', () => {
  it('ignores an equipment invoice when checking which SOW lines are already billed', async () => {
    const { service, created } = harness({
      existingInvoices: [{ _id: 'inv-eq', invoiceNumber: '04217-001', kind: 'EQUIPMENT', sowVersionNumber: 999, services: [], equipmentLines: [{ bookingId: 'bk-1', cost: 80 }] }]
    });

    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    expect(created).toHaveLength(1);
    // Neither refused, nor warned about: an equipment invoice is not comparable.
    expect(created[0].billingWarnings).toBeUndefined();
  });

  it('stamps a SOW invoice with its kind, so nothing has to infer it later', async () => {
    const { service, created } = harness();
    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);
    expect(created[0].kind).toBe('SOW');
  });
});

describe('an earlier invoice with no issued version to anchor it', () => {
  it('warns instead of comparing positions against a billing core that gets rewritten', async () => {
    // The countersign gate means THIS invoice always has a version in force. An
    // invoice generated before that gate may not, and its positions were taken
    // from the live core — which every workflow sync rewrites — so position 0 is
    // not the same line twice. That case stays reachable and must still warn.
    const { service, created } = harness({
      existingInvoices: [{ _id: 'inv-1', invoiceNumber: '04217-001', sowVersionNumber: null, services: [{ serviceId: 's1', sourceIndex: 0 }] }]
    });
    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);
    expect(created[0].billingWarnings).toEqual([expect.stringMatching(/live figures rather than an issued version/i)]);
    expect(created[0].sowVersionNumber).toBe(1000);
  });
});
