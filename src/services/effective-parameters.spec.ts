import { clashMessage, effectiveParameters, findParameterSetClashes, setsByIdMap, stripSetDerivedParameters } from './effective-parameters';
import { calculateServiceCostBreakdown } from '../pricing/service-pricing.util';
import { CustomerCategory } from '../pricing/customer-category';
import { ServicePricingMode } from './models/damplab-service.model';

const SET_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SET_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const buffers = {
  _id: SET_A,
  name: 'Buffers',
  parameters: [
    { id: 'buffer', name: 'Buffer', type: 'dropdown', paramGroupId: 'g1' },
    { id: 'volume', name: 'Volume', type: 'number' }
  ]
};
const cleanup = { _id: SET_B, name: 'Cleanup', parameters: [{ id: 'kit', name: 'Kit', type: 'string' }] };

describe('effectiveParameters', () => {
  it('lists own parameters, then each set in parameterSetIds order', () => {
    const result = effectiveParameters({ parameters: [{ id: 'own1', name: 'Own' }], parameterSetIds: [SET_B, SET_A] }, setsByIdMap([buffers, cleanup]));
    expect(result.map((p) => p.id)).toEqual(['own1', 'kit', 'buffer', 'volume']);
  });

  it('lets an own parameter win over a set parameter with the same id', () => {
    const result = effectiveParameters({ parameters: [{ id: 'volume', name: 'My volume' }], parameterSetIds: [SET_A] }, setsByIdMap([buffers]));
    expect(result).toHaveLength(2);
    expect(result.find((p) => p.id === 'volume')).toEqual({ id: 'volume', name: 'My volume' });
  });

  it('marks set parameters with their set and never marks own ones', () => {
    const result = effectiveParameters({ parameters: [{ id: 'own1' }], parameterSetIds: [SET_A] }, setsByIdMap([buffers]));
    expect(result[0]).not.toHaveProperty('fromParameterSetId');
    expect(result[1]).toMatchObject({ id: 'buffer', fromParameterSetId: SET_A, fromParameterSetName: 'Buffers', allowMultipleValues: false });
    expect(result[1]).not.toHaveProperty('paramGroupId');
  });

  it('skips a set id that no longer resolves, and tolerates missing arrays', () => {
    expect(effectiveParameters({ parameters: undefined, parameterSetIds: ['cccccccccccccccccccccccc'] }, setsByIdMap([]))).toEqual([]);
    expect(effectiveParameters({ parameters: [{ id: 'x' }] }, setsByIdMap([]))).toEqual([{ id: 'x' }]);
  });

  it('prices a set parameter exactly as an own one (pin 11)', () => {
    const option = { id: 'pbs', name: 'PBS', internalPrice: 12, price: 20 };
    const priced = { _id: SET_A, name: 'Buffers', parameters: [{ id: 'buffer', name: 'Buffer', type: 'dropdown', options: [option] }] };
    const viaSet: any = { pricingMode: ServicePricingMode.PARAMETER, parameters: effectiveParameters({ parameters: [], parameterSetIds: [SET_A] }, setsByIdMap([priced])) };
    const asOwn: any = { pricingMode: ServicePricingMode.PARAMETER, parameters: priced.parameters };
    const formData = [{ id: 'buffer', value: 'pbs' }];
    const a = calculateServiceCostBreakdown(viaSet, formData, undefined, CustomerCategory.INTERNAL_CUSTOMERS);
    const b = calculateServiceCostBreakdown(asOwn, formData, undefined, CustomerCategory.INTERNAL_CUSTOMERS);
    expect(a.cost).toBe(b.cost);
    expect(a.cost).toBe(12);
  });
});

describe('stripSetDerivedParameters', () => {
  it('drops set-derived entries and provenance keys, keeps own entries', () => {
    const input = [{ id: 'own' }, { id: 'buffer', fromParameterSetId: SET_A, fromParameterSetName: 'Buffers' }];
    expect(stripSetDerivedParameters(input)).toEqual([{ id: 'own' }]);
  });

  it('passes non-arrays through untouched', () => {
    expect(stripSetDerivedParameters(undefined)).toBeUndefined();
    expect(stripSetDerivedParameters(null)).toBeNull();
  });
});

describe('findParameterSetClashes', () => {
  it('reports a parameter id present in two different sets, naming both', () => {
    const clashes = findParameterSetClashes([buffers, { _id: SET_B, name: 'Cleanup', parameters: [{ id: 'volume' }] }]);
    expect(clashes).toEqual([{ parameterId: 'volume', firstSet: 'Buffers', secondSet: 'Cleanup' }]);
    expect(clashMessage(clashes[0])).toBe('Parameter id "volume" is in both "Buffers" and "Cleanup".');
  });

  it('finds nothing when the ids are distinct', () => {
    expect(findParameterSetClashes([buffers, cleanup])).toEqual([]);
  });
});
