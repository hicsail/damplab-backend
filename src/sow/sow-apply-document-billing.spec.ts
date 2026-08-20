import { SOWService } from './sow.service';

/**
 * Writing a document's adjustment edits back to the billing core.
 *
 * Service lines are deliberately absent from this path. Their figures come from
 * the job spec — what the customer proposed and the lab accepted — and are
 * refreshed by the workflow sync (see job.resolver's collectSowServiceInputs).
 * The document alters what it bills by adding a DISCOUNT or ADDITIONAL_COST,
 * which the customer sees as its own line with its own reason, never by
 * rewriting a price they already agreed to.
 */

interface Harness {
  service: SOWService;
  sowDoc: any;
}

function harness(services: Array<{ serviceId: string; name?: string; cost: number; unitCost?: number; multiplier?: number }>): Harness {
  const sowDoc: any = {
    services: services.map((s) => ({ serviceId: s.serviceId, name: s.name ?? s.serviceId, description: '', cost: s.cost, unitCost: s.unitCost, multiplier: s.multiplier })),
    pricing: { adjustments: [] }
  };

  const sowModel: any = {
    findById: () => ({ exec: async () => sowDoc }),
    findByIdAndUpdate: (_id: string, update: any): { exec: () => Promise<any> } => ({
      exec: async (): Promise<any> => {
        // Mirrors the real update: only `pricing` is in the $set. If a future
        // change starts writing `services` here, these tests fail loudly.
        if (update.$set.services !== undefined) sowDoc.services = update.$set.services;
        sowDoc.pricing = update.$set.pricing;
        return sowDoc;
      }
    })
  };

  const service = new SOWService(sowModel, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { service, sowDoc };
}

describe('applyDocumentBilling', () => {
  describe('service lines are owned by the job, not the document', () => {
    it('leaves every service line untouched', async () => {
      const { service, sowDoc } = harness([
        { serviceId: 'pcr', cost: 350, unitCost: 5, multiplier: 70 },
        { serviceId: 'gel', cost: 20, unitCost: 20, multiplier: 1 }
      ]);

      await service.applyDocumentBilling('sow-1', {
        adjustments: [{ type: 'ADDITIONAL_COST', description: 'Rush', amount: 100 }] as any
      });

      expect(sowDoc.services[0]).toMatchObject({ cost: 350, unitCost: 5, multiplier: 70 });
      expect(sowDoc.services[1]).toMatchObject({ cost: 20, unitCost: 20, multiplier: 1 });
    });

    it('never puts services in the update, so a sync cannot be clobbered mid-edit', async () => {
      const sowDoc: any = { services: [{ serviceId: 'pcr', name: 'PCR', description: '', cost: 350 }], pricing: { adjustments: [] } };
      let seen: any = null;
      const sowModel: any = {
        findById: () => ({ exec: async () => sowDoc }),
        findByIdAndUpdate: (_id: string, update: any): { exec: () => Promise<any> } => ({
          exec: async (): Promise<any> => {
            seen = update.$set;
            return sowDoc;
          }
        })
      };
      const service = new SOWService(sowModel, {} as any, {} as any, {} as any, {} as any, {} as any);

      await service.applyDocumentBilling('sow-1', { adjustments: [] as any });

      expect(seen).not.toBeNull();
      expect(seen.services).toBeUndefined();
    });

    it('still derives baseCost from the stored service lines', async () => {
      const { service, sowDoc } = harness([
        { serviceId: 'pcr', cost: 350 },
        { serviceId: 'gel', cost: 20 }
      ]);

      await service.applyDocumentBilling('sow-1', { adjustments: [] as any });

      expect(sowDoc.pricing.baseCost).toBe(370);
      expect(sowDoc.pricing.totalCost).toBe(370);
    });

    it('keeps each line at its own cost when the same service appears twice', async () => {
      const { service, sowDoc } = harness([
        { serviceId: 'pcr', cost: 350 }, // 70 runs
        { serviceId: 'pcr', cost: 5 } // 1 run
      ]);

      await service.applyDocumentBilling('sow-1', { adjustments: [] as any });

      expect(sowDoc.services[0].cost).toBe(350);
      expect(sowDoc.services[1].cost).toBe(5);
      expect(sowDoc.pricing.baseCost).toBe(355);
    });
  });

  describe('adjustments', () => {
    it('leaves the stored adjustments alone when none are sent', async () => {
      const { service, sowDoc } = harness([{ serviceId: 'pcr', cost: 350 }]);
      sowDoc.pricing.adjustments = [{ type: 'ADDITIONAL_COST', description: 'Kept', amount: 50 }];

      await service.applyDocumentBilling('sow-1', {});

      expect(sowDoc.pricing.adjustments).toEqual([{ type: 'ADDITIONAL_COST', description: 'Kept', amount: 50 }]);
      expect(sowDoc.pricing.totalCost).toBe(400);
    });

    /**
     * The client's `amount` is never trusted where it can be derived, because
     * that figure is what invoices bill from (invoice.service.ts prorates it)
     * long after the document is saved.
     */
    it('derives the figure from the unit amount and multiplier, ignoring the amount sent with them', async () => {
      const { service, sowDoc } = harness([{ serviceId: 'pcr', cost: 350 }]);

      await service.applyDocumentBilling('sow-1', {
        adjustments: [{ type: 'ADDITIONAL_COST', description: 'Staff time', amount: 1, unitAmount: 120, multiplier: 14, category: 'DAYS' }] as any
      });

      expect(sowDoc.pricing.adjustments[0]).toMatchObject({ amount: 1680, unitAmount: 120, multiplier: 14, category: 'DAYS' });
      expect(sowDoc.pricing.totalCost).toBe(2030);
    });

    it('treats an adjustment with no multiplier as multiplying by one', async () => {
      const { service, sowDoc } = harness([{ serviceId: 'pcr', cost: 350 }]);

      await service.applyDocumentBilling('sow-1', {
        adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 0, unitAmount: 75, category: 'SERVICE' }] as any
      });

      expect(sowDoc.pricing.adjustments[0].amount).toBe(75);
      expect(sowDoc.pricing.totalCost).toBe(275);
    });

    it('writes a bare amount through for an adjustment that carries no unit amount', async () => {
      const { service, sowDoc } = harness([{ serviceId: 'pcr', cost: 350 }]);

      await service.applyDocumentBilling('sow-1', {
        adjustments: [{ type: 'ADDITIONAL_COST', description: 'Rush', amount: 120 }] as any
      });

      expect(sowDoc.pricing.adjustments[0].amount).toBe(120);
      expect(sowDoc.pricing.adjustments[0].unitAmount).toBeUndefined();
      expect(sowDoc.pricing.totalCost).toBe(470);
    });
  });
});
