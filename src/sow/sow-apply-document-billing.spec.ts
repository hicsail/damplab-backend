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

function harness(services: Array<{ serviceId: string; name?: string; cost: number }>): Harness {
  const sowDoc: any = {
    services: services.map((s) => ({ serviceId: s.serviceId, name: s.name ?? s.serviceId, description: '', cost: s.cost })),
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
});
