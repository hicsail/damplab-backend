import { BadRequestException } from '@nestjs/common';
import { AddWorkflowInputPipe } from './add-workflow.input';
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

describe('AddNodeInputPipe refuses a storage key the caller did not upload (table-upload R1)', () => {
  const service = {
    _id: 'svc',
    name: 'Sequencing',
    price: 10,
    parameters: [
      {
        id: 'kind',
        name: 'Kind',
        type: 'dropdown',
        options: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' }
        ]
      },
      { id: 'doc', name: 'Protocol', type: 'file' },
      { id: 'docs', name: 'Extras', type: 'file', allowMultipleValues: true },
      { id: 'sheet', name: 'Samples', type: 'sampleSheet', templateFile: { key: 'sample-sheet-templates/blank.xlsx' } },
      { id: 'plate', name: 'Plate map', type: 'table', tableData: { columns: [{ header: 'Well', field: 'well' }] }, showIf: { parameterId: 'kind', op: 'eq', optionIds: ['a'] } },
      { id: 'note', name: 'Note', type: 'string' }
    ]
  };
  const file = (key: string): string => JSON.stringify({ filename: 'f.pdf', key, contentType: 'application/pdf', size: 3 });
  // On a real request the pipe's REQUEST is the GraphQL context: { req }, with the caller at req.user.
  const pipeFor = (user: any): AddNodeInputPipe => new AddNodeInputPipe({ findOneActive: async () => service } as any, { req: { user } });
  const node = (formData: any[], label = 'Sequence'): any => ({ id: 'n1', label, serviceId: 'svc', formData, additionalInstructions: '' });
  const customer = { sub: 'customer-1', realm_access: { roles: [] } };
  const staff = { sub: 'staff-1', realm_access: { roles: ['damplab-staff'] } };
  const own = (name: string): string => `workflow-parameters/customer-1/${name}`;
  const foreign = 'workflow-parameters/customer-2/secret.pdf';
  const REFUSAL = 'The file on "Sequence" was not uploaded by you. Upload it again and retry.';

  it('accepts files the caller uploaded, on every kind of file parameter', async () => {
    const formData = [
      { id: 'kind', value: 'a' },
      { id: 'doc', value: file(own('a.pdf')) },
      { id: 'docs', value: [file(own('b.pdf')), file(own('c.pdf'))] },
      { id: 'sheet', value: file(own('d.xlsx')) },
      { id: 'plate', value: file(own('e.csv')) }
    ];
    const out: any = await pipeFor(customer).transform(node(formData));
    expect(out.formData.map((e: any) => e.id)).toEqual(['kind', 'doc', 'docs', 'sheet', 'plate']);
  });

  it('accepts a staff member submitting for a client with files the staff member uploaded', async () => {
    const out: any = await pipeFor(staff).transform(
      node([
        { id: 'kind', value: 'a' },
        { id: 'doc', value: file('workflow-parameters/staff-1/a.pdf') }
      ])
    );
    expect(out.formData.map((e: any) => e.id)).toEqual(['kind', 'doc']);
  });

  it.each([
    ['a file parameter', 'doc'],
    ['a sample sheet', 'sheet'],
    ['a Table', 'plate']
  ])('refuses another user’s key on %s', async (_what, id) => {
    const call = (): Promise<any> =>
      pipeFor(customer).transform(
        node([
          { id: 'kind', value: 'a' },
          { id, value: file(foreign) }
        ])
      );
    await expect(call()).rejects.toBeInstanceOf(BadRequestException);
    await expect(call()).rejects.toThrow(REFUSAL);
  });

  it('refuses a staff member naming a customer’s key: staff own no one else’s uploads either', async () => {
    await expect(pipeFor(staff).transform(node([{ id: 'doc', value: file(own('a.pdf')) }]))).rejects.toThrow(REFUSAL);
  });

  it('refuses another user’s key among a multi-value parameter’s own files', async () => {
    await expect(pipeFor(customer).transform(node([{ id: 'docs', value: [file(own('b.pdf')), file(foreign)] }]))).rejects.toThrow(REFUSAL);
  });

  it('refuses the parsed-object form of a value just the same', async () => {
    await expect(pipeFor(customer).transform(node([{ id: 'doc', value: { filename: 'f.pdf', key: foreign } }]))).rejects.toThrow(REFUSAL);
  });

  it('refuses a key outside the upload area, and one that climbs out of the caller’s folder', async () => {
    for (const key of ['sample-sheet-templates/blank.xlsx', 'job-attachments/j1/secret.pdf', 'workflow-parameters/customer-1/../customer-2/x.pdf']) {
      await expect(pipeFor(customer).transform(node([{ id: 'doc', value: file(key) }]))).rejects.toThrow(REFUSAL);
    }
  });

  it('drops — does not refuse — the answer of a hidden parameter', async () => {
    const out: any = await pipeFor(customer).transform(
      node([
        { id: 'kind', value: 'b' },
        { id: 'plate', value: file(foreign) }
      ])
    );
    expect(out.formData.map((e: any) => e.id)).toEqual(['kind']);
  });

  it('lets through a file that was never stored: it has no key to presign', async () => {
    const out: any = await pipeFor(customer).transform(node([{ id: 'doc', value: JSON.stringify({ filename: 'f.pdf', notUploaded: true }) }]));
    expect(out.formData).toHaveLength(1);
  });

  it('ignores a key-shaped value on a parameter that holds no file', async () => {
    const out: any = await pipeFor(customer).transform(node([{ id: 'note', value: file(foreign) }]));
    expect(out.formData).toHaveLength(1);
  });

  it('names the operation by the service when the node has no label', async () => {
    await expect(pipeFor(customer).transform(node([{ id: 'doc', value: file(foreign) }], ''))).rejects.toThrow('The file on "Sequencing" was not uploaded by you. Upload it again and retry.');
  });

  it('fails closed when the request carries no caller', async () => {
    const pipe = new AddNodeInputPipe({ findOneActive: async () => service } as any, {});
    await expect(pipe.transform(node([{ id: 'doc', value: file(own('a.pdf')) }]))).rejects.toThrow(REFUSAL);
  });

  it('covers createJob and addWorkflowToJob: the workflow pipe both go through fails when any node does', async () => {
    const workflowPipe = new AddWorkflowInputPipe(pipeFor(customer));
    const workflow: any = { name: 'wf', nodes: [node([{ id: 'doc', value: file(own('a.pdf')) }]), node([{ id: 'doc', value: file(foreign) }])], edges: [] };
    await expect(workflowPipe.transform(workflow)).rejects.toThrow(REFUSAL);
  });
});
