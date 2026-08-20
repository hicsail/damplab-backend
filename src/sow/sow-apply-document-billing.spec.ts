import { SOWService } from './sow.service';

/**
 * Writing the Fee Schedule's edited costs back to the billing core.
 *
 * The bug this guards against: a job can use the same catalogue service more
 * than once (two PCR steps at different run counts, say). Costs used to be
 * matched by serviceId, so saving collapsed every line sharing that id onto
 * whichever cost came last in the request — a 70-run line silently became a
 * 1-run line's price. See sow-version.service.spec.ts / servicePricing.ts for
 * where the run-count multiplier itself is computed; this only covers whether
 * an already-computed cost lands on the right line when saved.
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
        sowDoc.services = update.$set.services;
        sowDoc.pricing = update.$set.pricing;
        return sowDoc;
      }
    })
  };

  const service = new SOWService(sowModel, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { service, sowDoc };
}

describe('applyDocumentBilling', () => {
  it('keeps each line at its own cost when the same service appears twice', async () => {
    const { service, sowDoc } = harness([
      { serviceId: 'pcr', cost: 350 }, // 70 runs
      { serviceId: 'pcr', cost: 5 } // 1 run
    ]);

    await service.applyDocumentBilling('sow-1', {
      serviceCosts: [
        { serviceId: 'pcr', cost: 350 },
        { serviceId: 'pcr', cost: 5 }
      ]
    });

    expect(sowDoc.services[0].cost).toBe(350);
    expect(sowDoc.services[1].cost).toBe(5);
  });

  it('applies an edited cost to the line it was edited on', async () => {
    const { service, sowDoc } = harness([{ serviceId: 'pcr', cost: 100 }]);

    await service.applyDocumentBilling('sow-1', { serviceCosts: [{ serviceId: 'pcr', cost: 275 }] });

    expect(sowDoc.services[0].cost).toBe(275);
  });

  it('leaves every line unchanged if the request has a different number of lines than the SOW', async () => {
    const { service, sowDoc } = harness([
      { serviceId: 'pcr', cost: 350 },
      { serviceId: 'gel', cost: 20 }
    ]);

    // Simulates a workflow sync having changed the SOW's lines while the
    // editor was still open with its old, now-shorter set.
    await service.applyDocumentBilling('sow-1', { serviceCosts: [{ serviceId: 'pcr', cost: 999 }] });

    expect(sowDoc.services[0].cost).toBe(350);
    expect(sowDoc.services[1].cost).toBe(20);
  });

  it('leaves a line unchanged if its position no longer matches the serviceId it was saved for', async () => {
    const { service, sowDoc } = harness([
      { serviceId: 'pcr', cost: 350 },
      { serviceId: 'gel', cost: 20 }
    ]);

    // Same length, but the order the client remembers no longer lines up —
    // must not silently apply "gel"'s edit onto the "pcr" line.
    await service.applyDocumentBilling('sow-1', {
      serviceCosts: [
        { serviceId: 'gel', cost: 999 },
        { serviceId: 'pcr', cost: 888 }
      ]
    });

    expect(sowDoc.services[0].cost).toBe(350);
    expect(sowDoc.services[1].cost).toBe(20);
  });

  it('recomputes baseCost and totalCost from the applied costs', async () => {
    const { service } = harness([
      { serviceId: 'pcr', cost: 350 },
      { serviceId: 'pcr', cost: 5 }
    ]);

    const updated = await service.applyDocumentBilling('sow-1', {
      serviceCosts: [
        { serviceId: 'pcr', cost: 350 },
        { serviceId: 'pcr', cost: 5 }
      ]
    });

    expect(updated.pricing.baseCost).toBe(355);
    expect(updated.pricing.totalCost).toBe(355);
  });

  /**
   * The Fee Schedule box holds the base price, not the line total, so the
   * multiplier the workflow baked in has to be re-applied here — the document
   * has no control that could have changed it.
   */
  it('derives the line total from an edited unit price and the stored multiplier', async () => {
    const { service, sowDoc } = harness([{ serviceId: 'pcr', cost: 350, unitCost: 5, multiplier: 70 }]);

    await service.applyDocumentBilling('sow-1', { serviceCosts: [{ serviceId: 'pcr', unitCost: 6, cost: 350 }] });

    expect(sowDoc.services[0].unitCost).toBe(6);
    expect(sowDoc.services[0].cost).toBe(420);
  });

  it('keeps the total to the cent when the unit price does not divide evenly', async () => {
    const { service, sowDoc } = harness([{ serviceId: 'pcr', cost: 9.9, unitCost: 3.3, multiplier: 3 }]);

    await service.applyDocumentBilling('sow-1', { serviceCosts: [{ serviceId: 'pcr', unitCost: 3.3, cost: 9.9 }] });

    expect(sowDoc.services[0].cost).toBe(9.9);
  });

  it('treats a line with no multiplier as multiplying by one', async () => {
    const { service, sowDoc } = harness([{ serviceId: 'gel', cost: 20 }]);

    await service.applyDocumentBilling('sow-1', { serviceCosts: [{ serviceId: 'gel', unitCost: 25, cost: 20 }] });

    expect(sowDoc.services[0].cost).toBe(25);
  });

  it('does not read an explicit null unit price as a free line', async () => {
    const { service, sowDoc } = harness([{ serviceId: 'pcr', cost: 350 }]);

    await service.applyDocumentBilling('sow-1', { serviceCosts: [{ serviceId: 'pcr', unitCost: null as any, cost: 275 }] });

    expect(sowDoc.services[0].cost).toBe(275);
  });

  it('still writes a bare cost through for a caller that sends no unit price', async () => {
    const { service, sowDoc } = harness([{ serviceId: 'pcr', cost: 350, unitCost: 5, multiplier: 70 }]);

    await service.applyDocumentBilling('sow-1', { serviceCosts: [{ serviceId: 'pcr', cost: 275 }] });

    expect(sowDoc.services[0].cost).toBe(275);
    expect(sowDoc.services[0].unitCost).toBe(5);
  });

  /**
   * Adjustments follow the same rule as service lines: the client's `amount` is
   * never trusted where it can be derived, because that figure is what invoices
   * bill from (invoice.service.ts prorates it) long after the document is saved.
   */
  describe('adjustments', () => {
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
