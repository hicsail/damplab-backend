import { WorkflowNodeSchema } from './node.model';

describe('WorkflowNode schema', () => {
  it('refs the service model, not WorkflowNode (F6)', () => {
    expect((WorkflowNodeSchema.path('service') as any).options.ref).toBe('DampLabService');
  });

  it('leaves parameterSnapshot absent rather than defaulting it to []', () => {
    expect((WorkflowNodeSchema.path('parameterSnapshot') as any).options.default).toBeUndefined();
  });
});
