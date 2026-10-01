import { AddNodeInputPipe } from './add-node.input';

describe('AddNodeInputPipe (createJob / addWorkflowToJob path)', () => {
  it('writes a parameter snapshot from the service it validated against', async () => {
    const service = { _id: 'svc', name: 'Gibson', price: 10, parameters: [{ id: 'vol', name: 'Volume', type: 'number' }] };
    const pipe = new AddNodeInputPipe({ findOneActive: async () => service } as any, { user: { realm_access: { roles: [] } } });
    const out = await pipe.transform({ id: 'n1', label: 'Gibson', serviceId: 'svc', formData: [{ id: 'vol', value: 7 }], additionalInstructions: '' } as any);
    expect(out.parameterSnapshot).toEqual([{ id: 'vol', name: 'Volume', type: 'number', displayValue: '7' }]);
  });
});
