import { WorkflowNodeService } from './node.service';

/**
 * `getByIDs` is what `Workflow.nodes` resolves through, so its ordering is the
 * ordering every operation list in the UI ends up rendering. Mongo's `$in` gives
 * back natural (creation) order, which only coincides with the workflow's stored
 * flow order until an edit inserts a node mid-chain.
 */
describe('WorkflowNodeService.getByIDs', () => {
  const NODE_A = '00000000000000000000000a';
  const NODE_B = '00000000000000000000000b';
  const NODE_C = '00000000000000000000000c';

  /** Stands in for Mongo: answers `$in` in creation order, never the argument's. */
  const serviceReturning = (creationOrder: string[]): WorkflowNodeService => {
    const nodeModel = {
      find: jest.fn(async ({ _id }: { _id: { $in: string[] } }) => {
        const wanted = new Set(_id.$in.map(String));
        return creationOrder.filter((id) => wanted.has(id)).map((id) => ({ _id: id }));
      })
    };

    return new WorkflowNodeService(nodeModel as any, {} as any, {} as any, {} as any);
  };

  it('returns nodes in the order they were asked for, not the order Mongo stored them', async () => {
    const service = serviceReturning([NODE_A, NODE_B, NODE_C]);

    const result = await service.getByIDs([NODE_C, NODE_A, NODE_B]);

    expect(result.map((node) => String(node._id))).toEqual([NODE_C, NODE_A, NODE_B]);
  });

  it('places a newly created node where the workflow puts it, not last', async () => {
    // The reported bug: B is inserted between A and C by an edit, so it is the
    // newest document, but the workflow lists it second.
    const service = serviceReturning([NODE_A, NODE_C, NODE_B]);

    const result = await service.getByIDs([NODE_A, NODE_B, NODE_C]);

    expect(result.map((node) => String(node._id))).toEqual([NODE_A, NODE_B, NODE_C]);
  });

  it('drops ids with no matching document rather than leaving a hole', async () => {
    const service = serviceReturning([NODE_A, NODE_C]);

    const result = await service.getByIDs([NODE_A, NODE_B, NODE_C]);

    expect(result.map((node) => String(node._id))).toEqual([NODE_A, NODE_C]);
  });

  it('returns nothing for an empty id list', async () => {
    const service = serviceReturning([NODE_A, NODE_B]);

    expect(await service.getByIDs([])).toEqual([]);
  });
});
