import { AddNodeInputPipe } from './add-node.input';

describe('AddNodeInputPipe (createJob / addWorkflowToJob path)', () => {
  it('writes a parameter snapshot from the service it validated against', async () => {
    const service = { _id: 'svc', name: 'Gibson', price: 10, parameters: [{ id: 'vol', name: 'Volume', type: 'number' }] };
    const pipe = new AddNodeInputPipe({ findOneActive: async () => service } as any, { user: { realm_access: { roles: [] } } });
    const out = await pipe.transform({ id: 'n1', label: 'Gibson', serviceId: 'svc', formData: [{ id: 'vol', value: 7 }], additionalInstructions: '' } as any);
    expect(out.parameterSnapshot).toEqual([{ id: 'vol', name: 'Volume', type: 'number', displayValue: '7' }]);
  });
});

describe('AddNodeInputPipe discards answers to hidden parameters (show-only-if rule 17)', () => {
  const service = {
    _id: 'svc',
    name: 'Extraction',
    pricingMode: 'PARAMETER',
    parameters: [
      {
        id: 'sample',
        name: 'Sample Type',
        type: 'dropdown',
        options: [
          { id: 'bact', name: 'Bacteria', price: 10 },
          { id: 'yeast', name: 'Yeast', price: 20 }
        ]
      },
      {
        id: 'lysis',
        name: 'Lysis',
        type: 'dropdown',
        showIf: { parameterId: 'sample', op: 'eq', optionIds: ['bact'] },
        options: [
          { id: 'enz', name: 'Enzymatic', price: 7 },
          { id: 'oth', name: 'Other', price: 9 }
        ]
      }
    ]
  };
  const transform = (sample: string): Promise<any> =>
    new AddNodeInputPipe({ findOneActive: async () => service } as any, { user: { realm_access: { roles: [] } } }).transform({
      id: 'n1',
      label: 'Extraction',
      serviceId: 'svc',
      additionalInstructions: '',
      formData: [
        { id: 'sample', value: sample },
        { id: 'lysis', value: 'oth' },
        { id: 'lysis__otherText', value: 'Bead beating' },
        { id: '__runCount', value: 2 }
      ]
    } as any);

  it('stores, prices and snapshots the answer while the parameter is shown', async () => {
    const out = await transform('bact');
    expect(out.formData.map((e: any) => e.id)).toEqual(['sample', 'lysis', 'lysis__otherText', '__runCount']);
    expect(out.price).toBe((10 + 9) * 2);
  });

  it('drops the hidden answer and its "Other" text before pricing and storing — it is not refused', async () => {
    const out = await transform('yeast');
    expect(out.formData).toEqual([
      { id: 'sample', value: 'yeast' },
      { id: '__runCount', value: 2 }
    ]);
    expect(out.price).toBe(20 * 2);
    expect(out.parameterSnapshot.map((e: any) => e.id)).toEqual(['sample', '__runCount']);
  });
});
