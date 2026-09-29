import mongoose from 'mongoose';
import { buildCatalogExport } from './catalog-export.builder';

const oid = (hex: string): any => ({ toString: () => hex });

const pcr = {
  _id: oid('s1'),
  name: 'PCR',
  icon: 'pcr.png',
  price: 10,
  pricingMode: 'SERVICE',
  description: 'Amplify',
  parameters: [{ id: 'cycles' }, { id: 'buffer', fromParameterSetId: 'p1', fromParameterSetName: 'Buffers' }],
  ownParameters: [{ id: 'cycles' }],
  parameterSetIds: [oid('p1')],
  hiddenFromClients: true,
  allowedConnections: [oid('s2'), oid('gone')],
  pricing: { internal: 5, legacy: 10 },
  paramGroups: [],
  resultParams: [],
  result: null,
  deliverables: ['gel'],
  protocolIds: [],
  inventoryRequirements: [oid('i1')],
  serviceCategoryNumber: '1',
  serviceCategoryName: 'Mol',
  unit: 'rxn',
  notes: 'n'
};
const gibson = { ...pcr, _id: oid('s2'), name: 'Gibson', allowedConnections: [], parameterSetIds: [], hiddenFromClients: false, ownParameters: [], parameters: [] };

const exported = buildCatalogExport({
  services: [pcr, gibson],
  categories: [{ _id: oid('c1'), label: 'Cloning', services: [oid('s1'), oid('gone')] }],
  bundles: [{ _id: oid('b1'), label: 'Clone', icon: 'x', services: [oid('s1'), oid('s2')] }],
  parameterSets: [{ _id: oid('p1'), name: 'Buffers', description: undefined, parameters: [{ id: 'buffer' }] }],
  inventory: [{ _id: oid('i1'), name: 'Thermocycler', isDeleted: false }],
  sowPresets: [{ _id: oid('t1'), sectionKey: 'scope', name: 'Default', text: 'Words', order: 10 }],
  now: new Date('2026-09-29T12:00:00Z')
});

describe('buildCatalogExport (pin 34)', () => {
  it('has exactly the documented top-level keys', () => {
    expect(Object.keys(exported).sort()).toEqual(['bundles', 'categories', 'exportedAt', 'inventory', 'parameterSets', 'services', 'sowSections']);
    expect(exported.exportedAt).toBe('2026-09-29T12:00:00.000Z');
  });

  it('carries every seed ServiceInput key, with string ids and OWN parameters', () => {
    const s = exported.services[0];
    for (const key of ['id', 'name', 'icon', 'price', 'pricingMode', 'parameters', 'allowedConnections', 'categories', 'result', 'description', 'resultParams', 'paramGroups']) {
      expect(s).toHaveProperty(key);
    }
    expect(s.id).toBe('s1');
    expect(s.parameters).toEqual([{ id: 'cycles' }]);
    expect(s.allowedConnections).toEqual(['s2']); // references outside the export are dropped
    expect(s.categories).toEqual(['c1']);
  });

  it('adds the superset fields: full pricing, parameterSetIds, hiddenFromClients', () => {
    expect(exported.services[0]).toMatchObject({ pricing: { internal: 5, legacy: 10 }, parameterSetIds: ['p1'], hiddenFromClients: true, inventoryRequirements: ['i1'] });
  });

  it('refers to services by the same string ids in categories and bundles', () => {
    expect(exported.categories).toEqual([{ id: 'c1', label: 'Cloning' }]);
    expect(exported.bundles).toEqual([{ id: 'b1', label: 'Clone', icon: 'x', services: ['s1', 's2'] }]);
  });

  it('stringifies real ObjectIds in cross-references', () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const out = buildCatalogExport({
      services: [
        { _id: a, name: 'A', allowedConnections: [b] },
        { _id: b, name: 'B', allowedConnections: [] }
      ],
      categories: [],
      bundles: [{ _id: new mongoose.Types.ObjectId(), label: 'AB', services: [a, b] }],
      parameterSets: [],
      inventory: [],
      sowPresets: [],
      now: new Date()
    });
    expect(out.services[0]).toMatchObject({ id: a.toHexString(), allowedConnections: [b.toHexString()] });
    expect(out.bundles[0].services).toEqual([a.toHexString(), b.toHexString()]);
  });

  it('exports sets, inventory and SOW text blocks', () => {
    expect(exported.parameterSets).toEqual([{ id: 'p1', name: 'Buffers', description: null, parameters: [{ id: 'buffer' }] }]);
    expect(exported.inventory[0]).toMatchObject({ id: 'i1', name: 'Thermocycler' });
    expect(exported.sowSections).toEqual([{ sectionKey: 'scope', name: 'Default', text: 'Words', order: 10 }]);
  });
});
