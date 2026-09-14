import { SOWService } from './sow.service';

/**
 * `baseCost` contracts for what the document bills; `estimatedEquipmentCost`
 * is the other half of the same split (service-pricing.util's
 * `splitContractedLines`), stated on the document but folded into no total.
 *
 * Mirrors the harness style of sow-apply-document-billing.spec.ts: a stub
 * `sowModel` with `findById`/`findByIdAndUpdate`, `SOWService` constructed
 * positionally.
 */

const EQUIP = 'Plate reader — 10 hrs/wk x 4 wks (estimate; billed on actual hours)';

interface Harness {
  service: SOWService;
  sowDoc: any;
}

function harness(services: Array<{ serviceId: string; description?: string; cost: number }>, adjustments: any[] = []): Harness {
  const sowDoc: any = {
    services: services.map((s) => ({ serviceId: s.serviceId, name: s.serviceId, description: s.description ?? '', cost: s.cost })),
    pricing: { adjustments }
  };

  const sowModel: any = {
    findById: () => ({ exec: async () => sowDoc }),
    findByIdAndUpdate: (_id: string, update: any): { exec: () => Promise<any> } => ({
      exec: async (): Promise<any> => {
        if (update.$set.services !== undefined) sowDoc.services = update.$set.services;
        sowDoc.pricing = update.$set.pricing;
        return sowDoc;
      }
    })
  };

  const service = new SOWService(sowModel, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { service, sowDoc };
}

describe('the contracted/equipment split in live pricing', () => {
  describe('applyDocumentBilling', () => {
    it('leaves the equipment estimate out of baseCost and reports it beside it', async () => {
      const { service, sowDoc } = harness([
        { serviceId: 'amp', description: 'Amplification', cost: 350 },
        { serviceId: 'plate-reader', description: EQUIP, cost: 45 }
      ]);

      await service.applyDocumentBilling('sow-1', {
        adjustments: [{ type: 'DISCOUNT', description: 'Discount', amount: 50 }] as any
      });

      expect(sowDoc.pricing.baseCost).toBe(350);
      expect(sowDoc.pricing.totalCost).toBe(300);
      expect(sowDoc.pricing.estimatedEquipmentCost).toBe(45);
    });

    it('bills nothing at all for a job that is only equipment use', async () => {
      const { service, sowDoc } = harness([{ serviceId: 'plate-reader', description: EQUIP, cost: 45 }]);

      await service.applyDocumentBilling('sow-1', { adjustments: [] as any });

      expect(sowDoc.pricing.baseCost).toBe(0);
      expect(sowDoc.pricing.totalCost).toBe(0);
      expect(sowDoc.pricing.estimatedEquipmentCost).toBe(45);
    });

    it('reports a zero estimate when there is no equipment line', async () => {
      const { service, sowDoc } = harness([{ serviceId: 'amp', description: 'Amplification', cost: 350 }]);

      await service.applyDocumentBilling('sow-1', { adjustments: [] as any });

      expect(sowDoc.pricing.baseCost).toBe(350);
      expect(sowDoc.pricing.estimatedEquipmentCost).toBe(0);
    });
  });

  describe('update — the erasure guard', () => {
    it('carries estimatedEquipmentCost on the whole pricing object update writes', async () => {
      const sowDoc: any = {
        _id: 'sow-1',
        jobId: 'job-1',
        services: [
          { serviceId: 'amp', name: 'amp', description: 'Amplification', cost: 350 },
          { serviceId: 'plate-reader', name: 'plate-reader', description: EQUIP, cost: 45 }
        ],
        pricing: { adjustments: [], baseCost: 350, totalCost: 350 }
      };
      let seenUpdateData: any = null;
      const sowModel: any = {
        findById: () => ({ exec: async () => sowDoc }),
        findByIdAndUpdate: (_id: string, update: any): { exec: () => Promise<any> } => ({
          exec: async (): Promise<any> => {
            seenUpdateData = update.$set;
            sowDoc.pricing = update.$set.pricing;
            return sowDoc;
          }
        })
      };
      const jobService: any = { findById: async () => null };
      const service = new SOWService(sowModel, {} as any, jobService, {} as any, {} as any, {} as any);

      await service.update('sow-1', {
        pricing: { adjustments: [{ type: 'ADDITIONAL_COST', description: 'Rush', amount: 25 }] }
      } as any);

      expect(seenUpdateData.pricing.baseCost).toBe(350);
      expect(seenUpdateData.pricing.totalCost).toBe(375);
      expect(seenUpdateData.pricing.estimatedEquipmentCost).toBe(45);
    });
  });
});
