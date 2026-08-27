import { WorkflowNodeService } from './node.service';

/**
 * Unassigning used to be a silent no-op.
 *
 * `$set: { assigneeId: assigneeId ?? undefined }` — and Mongoose strips undefined
 * out of `$set`, so the mutation returned success and the old assignee stayed put.
 * The merged jobs page's "Worked by me" scope and its technician filter both join
 * on `assigneeId`, so a stale one keeps a technician attached to work they were
 * taken off.
 */
describe('WorkflowNodeService.updateAssignee', () => {
  const harness = () => {
    const findOneAndUpdate = jest.fn(async (_filter: unknown, _update: unknown, _options?: unknown) => ({ _id: 'node-1' }));
    const service = new WorkflowNodeService({ findOneAndUpdate } as any, {} as any, {} as any, {} as any);
    return { service, findOneAndUpdate };
  };

  it('$sets on assign', async () => {
    const { service, findOneAndUpdate } = harness();
    await service.updateAssignee({ _id: 'node-1' } as any, 'tech-7', 'Tech Seven');
    expect(findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { assigneeId: 'tech-7', assigneeDisplayName: 'Tech Seven' } });
  });

  it('$unsets on unassign, rather than $setting undefined', async () => {
    const { service, findOneAndUpdate } = harness();
    await service.updateAssignee({ _id: 'node-1' } as any, null, null);
    expect(findOneAndUpdate.mock.calls[0][1]).toEqual({ $unset: { assigneeId: '', assigneeDisplayName: '' } });
  });
});

describe('WorkflowNodeService.updateEstimatedMinutes', () => {
  const harness = () => {
    const findOneAndUpdate = jest.fn(async (_filter: unknown, _update: unknown, _options?: unknown) => ({ _id: 'node-1' }));
    const service = new WorkflowNodeService({ findOneAndUpdate } as any, {} as any, {} as any, {} as any);
    return { service, findOneAndUpdate };
  };

  it('$sets a value, including zero', async () => {
    const { service, findOneAndUpdate } = harness();
    await service.updateEstimatedMinutes({ _id: 'node-1' } as any, 0);
    // `?? undefined` would have kept 0, but a truthiness check would have dropped
    // it — worth pinning, since "no estimate" and "zero minutes" differ.
    expect(findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { estimatedMinutes: 0 } });
  });

  it('$unsets on clear', async () => {
    const { service, findOneAndUpdate } = harness();
    await service.updateEstimatedMinutes({ _id: 'node-1' } as any, null);
    expect(findOneAndUpdate.mock.calls[0][1]).toEqual({ $unset: { estimatedMinutes: '' } });
  });
});
