import { SOWService } from './sow.service';

/**
 * What the workflow sync hands the SOW, and what it deliberately does not.
 *
 * `node.price` is a line total — `calculateServiceCost` returns unit price times
 * multiplier. This used to be written into `unitCost` as well as `cost`, and
 * `transformServices` passes `unitCost` on as a *unit* fallback, so a catalog
 * service with no resolvable price of its own was multiplied a second time:
 * `unit x N x N`. The seam is only safe while this emits the total once, under
 * the name that says it is a total.
 */
function harness(nodes: unknown[]): SOWService {
  const workflowService: any = { findById: async () => ({ nodes: nodes.map((_n, i) => `n${i}`) }) };
  const workflowNodeService: any = { getByIDs: async () => nodes };
  return new SOWService({} as any, {} as any, {} as any, {} as any, workflowService, workflowNodeService);
}

const job: any = { workflows: ['wf1'] };

describe('collectSowServiceInputs', () => {
  it('emits the node price as a line total and nothing as a unit price', async () => {
    const service = harness([{ _id: 'n0', service: { _id: 'svc-a' }, label: 'PCR', price: 200, formData: [] }]);

    const [line] = await service.collectSowServiceInputs(job);

    expect(line.cost).toBe(200);
    expect(line.unitCost).toBeUndefined();
  });

  it('keeps the node order the workflow declares', async () => {
    const service = harness([
      { _id: 'n0', service: { _id: 'svc-a' }, label: 'PCR', price: 10, formData: [] },
      { _id: 'n1', service: { _id: 'svc-b' }, label: 'Gel', price: 20, formData: [] }
    ]);

    const lines = await service.collectSowServiceInputs(job);

    expect(lines.map((l: any) => l.id)).toEqual(['svc-a', 'svc-b']);
  });

  it('carries the node formData through, which is what the line is repriced from', async () => {
    const formData = [{ id: '__runCount', value: 4 }];
    const service = harness([{ _id: 'n0', service: { _id: 'svc-a' }, label: 'PCR', price: 200, formData }]);

    const [line] = await service.collectSowServiceInputs(job);

    expect(line.formData).toEqual(formData);
  });

  it('reuses the stored name, description and category, but never a stored price', async () => {
    const service = harness([{ _id: 'n0', service: { _id: 'svc-a' }, label: 'PCR', price: 200, formData: [] }]);
    const existing = [{ name: 'Named by staff', description: 'Described by staff', category: 'sequencing', cost: 999, unitCost: 999 }];

    const [line] = await service.collectSowServiceInputs(job, existing);

    expect(line).toMatchObject({ name: 'Named by staff', description: 'Described by staff', category: 'sequencing', cost: 200 });
    expect(line.unitCost).toBeUndefined();
  });

  it('treats a node with no price as zero rather than undefined', async () => {
    const service = harness([{ _id: 'n0', service: { _id: 'svc-a' }, label: 'PCR', formData: [] }]);

    const [line] = await service.collectSowServiceInputs(job);

    expect(line.cost).toBe(0);
  });
});
