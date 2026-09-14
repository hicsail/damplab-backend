import { SOWService } from './sow.service';

/**
 * `SOWPricing.discount` is dead schema on its way out.
 *
 * It never affected any total — nothing that computes money reads it, and no UI has
 * ever set it. The mechanism that works is a `DISCOUNT` entry in
 * `pricing.adjustments`, which reduces the total, rides onto invoices and is
 * prorated across partial ones.
 *
 * These pin the two halves of the deprecation, because getting either wrong is
 * worse than leaving the field alone:
 *
 *   - nothing NEW is persisted, on create or update;
 *   - nothing STORED is destroyed, because the update assignment replaces the whole
 *     `pricing` object and simply omitting the key would erase a legacy discount on
 *     the next unrelated pricing edit.
 */

const discountInput = { amount: 250, reason: 'Grant funded' };

function harness(storedPricing?: any): { service: SOWService; created: any[]; updates: any[] } {
  const created: any[] = [];
  const updates: any[] = [];
  const stored = {
    _id: 'sow-1',
    jobId: 'job-1',
    pricing: storedPricing ?? { baseCost: 1000, adjustments: [], totalCost: 1000 },
    // One $1000 line, so the pricing-consistency check the update runs is satisfied
    // and the assertions can be about the discount field alone.
    services: [{ serviceId: 's1', name: 'PCR', cost: 1000 }],
    toObject(): any {
      return this;
    }
  };

  const sowModel: any = Object.assign(
    function SowModel(doc: any) {
      created.push(doc);
      return { ...doc, _id: 'sow-new', save: async (): Promise<any> => doc };
    },
    {
      create: async (doc: any): Promise<any> => {
        created.push(doc);
        return { ...doc, _id: 'sow-new' };
      },
      findById: () => ({ exec: async (): Promise<any> => stored }),
      findByIdAndUpdate: (_id: string, update: any) => {
        updates.push(update.$set);
        return { exec: async (): Promise<any> => ({ ...stored, ...update.$set }) };
      },
      findOne: () => ({ exec: async (): Promise<any> => null }),
      countDocuments: () => ({ exec: async (): Promise<number> => 0 })
    }
  );

  const noop: any = {};
  const jobService: any = { findById: async () => ({ _id: 'job-1', jobId: '04217', name: 'Test job', customerCategory: 'INTERNAL_CUSTOMERS' }) };
  // One $1000 catalog line, matching the stored SOW, so create's pricing-consistency
  // check passes and the assertions can be about the discount field alone.
  const dampLabServices: any = { findOne: async () => ({ _id: 's1', name: 'PCR', isDeleted: false, pricing: { internal: 1000, legacy: 1000 } }) };
  const sowVersionService: any = { createInitialVersion: async (): Promise<void> => undefined };
  const service = new SOWService(sowModel, dampLabServices, jobService, sowVersionService, noop, noop);
  return { service, created, updates };
}

describe('SOWPricing.discount deprecation — create', () => {
  it('does not persist a discount supplied on create', async () => {
    const { service, created } = harness();

    await service.create({
      jobId: 'job-1',
      sowTitle: 'Test',
      services: [{ id: 's1', name: 'PCR', description: '', cost: 1000, category: 'Sequencing' }],
      pricing: { baseCost: 1000, adjustments: [], totalCost: 1000, discount: discountInput },
      createdBy: 'tech@bu.edu'
    } as any);

    // A new SOW must not acquire a field that has never affected a total.
    expect(created[0].pricing.discount).toBeUndefined();
    // estimatedEquipmentCost 0 is Task 2's addition: the single catalog line here
    // is not an equipment-use line, so nothing is estimated.
    expect(created[0].pricing).toEqual({ baseCost: 1000, adjustments: [], totalCost: 1000, estimatedEquipmentCost: 0 });
  });
});

describe('SOWPricing.discount deprecation — update', () => {
  it('does not persist a discount supplied on update', async () => {
    const { service, updates } = harness();

    await service.update('sow-1', { pricing: { baseCost: 1000, adjustments: [], totalCost: 1000, discount: discountInput } } as any);

    expect(updates[0].pricing.discount).toBeUndefined();
  });

  it('does not erase a discount a legacy document already carries', async () => {
    // The update replaces the whole pricing object, so this is the difference
    // between "stops being refreshed" and "destroyed on the next unrelated edit".
    const { service, updates } = harness({ baseCost: 1000, adjustments: [], totalCost: 1000, discount: { amount: 99, reason: 'Legacy' } });

    await service.update('sow-1', { pricing: { baseCost: 1000, adjustments: [], totalCost: 1000 } } as any);

    expect(updates[0].pricing.discount).toEqual({ amount: 99, reason: 'Legacy' });
  });

  it('ignores an input discount rather than letting it overwrite the stored one', async () => {
    const { service, updates } = harness({ baseCost: 1000, adjustments: [], totalCost: 1000, discount: { amount: 99, reason: 'Legacy' } });

    await service.update('sow-1', { pricing: { baseCost: 1000, adjustments: [], totalCost: 1000, discount: discountInput } } as any);

    expect(updates[0].pricing.discount).toEqual({ amount: 99, reason: 'Legacy' });
  });

  it('leaves the total alone either way, because the field never moved money', async () => {
    const { service, updates } = harness();

    await service.update('sow-1', { pricing: { baseCost: 1000, adjustments: [], totalCost: 1000, discount: discountInput } } as any);

    // $250 "discount" and the total is still $1000 — which is the whole reason the
    // field is being removed rather than wired up.
    expect(updates[0].pricing.totalCost).toBe(1000);
  });
});
