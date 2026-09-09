import { BadRequestException } from '@nestjs/common';
import { DampLabServices } from './damplab-services.services';
import { EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE } from './equipment-use.validation';

/**
 * The server-side twin of the catalog editor's inline warning. Exercised against
 * hand-rolled doubles rather than Mongo: the rule is the thing under test, not the
 * driver.
 */
const inventory = (items: Array<{ _id: string; bookable: boolean }>): { findByIds: jest.Mock } => ({
  findByIds: jest.fn().mockResolvedValue(items)
});

const model = (): { create: jest.Mock; updateOne: jest.Mock; findById: jest.Mock } => {
  const doc = { _id: 's1', name: 'Plate reader time', parameters: [], allowedConnections: [], protocolIds: [], deliverables: [] };
  return {
    create: jest.fn().mockResolvedValue(doc),
    updateOne: jest.fn().mockResolvedValue({}),
    findById: jest.fn().mockResolvedValue(doc)
  };
};

const build = (m: any, inv: any): DampLabServices => new DampLabServices(m as any, inv as any);

describe('DampLabServices.create — equipment-use rule', () => {
  it('rejects an equipment-use service with no bookable requirement', async () => {
    const m = model();
    const svc = build(m, inventory([{ _id: 'i1', bookable: false }]));

    await expect(svc.create({ equipmentUse: true, inventoryRequirements: ['i1'] } as any)).rejects.toThrow(BadRequestException);
    await expect(svc.create({ equipmentUse: true, inventoryRequirements: ['i1'] } as any)).rejects.toThrow(EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('accepts an equipment-use service with a bookable requirement', async () => {
    const m = model();
    const svc = build(m, inventory([{ _id: 'i1', bookable: true }]));

    await expect(svc.create({ equipmentUse: true, inventoryRequirements: ['i1'] } as any)).resolves.toBeDefined();
    expect(m.create).toHaveBeenCalled();
  });

  it('never looks at inventory for a service that is not equipment use', async () => {
    const m = model();
    const inv = inventory([]);
    const svc = build(m, inv);

    await expect(svc.create({ inventoryRequirements: [] } as any)).resolves.toBeDefined();
    expect(inv.findByIds).not.toHaveBeenCalled();
  });
});

describe('DampLabServices.update — equipment-use rule', () => {
  const stored = (over: Record<string, unknown> = {}): any => ({ _id: 's1', ...over } as any);

  it('rejects turning the flag on without a bookable requirement', async () => {
    const svc = build(model(), inventory([{ _id: 'i1', bookable: false }]));
    await expect(svc.update(stored({ inventoryRequirements: ['i1'] }), { equipmentUse: true } as any)).rejects.toThrow(EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE);
  });

  it('rejects stripping the last bookable requirement from an equipment-use service', async () => {
    const svc = build(model(), inventory([]));
    await expect(svc.update(stored({ equipmentUse: true, inventoryRequirements: ['i1'] }), { inventoryRequirements: [] } as any)).rejects.toThrow(EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE);
  });

  it('accepts an update that leaves a bookable requirement in place', async () => {
    const m = model();
    const svc = build(m, inventory([{ _id: 'i2', bookable: true }]));
    await expect(svc.update(stored({ equipmentUse: true, inventoryRequirements: ['i1'] }), { inventoryRequirements: ['i2'] } as any)).resolves.toBeDefined();
    expect(m.updateOne).toHaveBeenCalled();
  });

  it('does not check inventory when neither field is in play', async () => {
    const inv = inventory([]);
    const svc = build(model(), inv);
    await expect(svc.update(stored({ name: 'x' }), { name: 'y' } as any)).resolves.toBeDefined();
    expect(inv.findByIds).not.toHaveBeenCalled();
  });
});
