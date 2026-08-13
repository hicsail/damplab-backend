import { BadRequestException } from '@nestjs/common';
import { JobVersionService } from './job-version.service';
import { JobVersionAuthorRole } from './job-version.model';
import { WorkflowNodeState } from '../workflow/models/node.model';

/**
 * The baseline rule is pure, so it is exercised directly. Everything else runs
 * against a small in-memory stand-in for the four collections `saveWorkflows`
 * touches — enough to pin the two properties that actually matter: that a save
 * never disturbs live lab state, and that it cannot persist a field it was not
 * told about.
 */

// ------------------------------------------------------------------ baseline

describe('baselineFor', () => {
  const v = (versionNumber: number, authorRole: JobVersionAuthorRole): { versionNumber: number; authorRole: JobVersionAuthorRole } => ({ versionNumber, authorRole });
  const CUSTOMER = JobVersionAuthorRole.CUSTOMER;
  const STAFF = JobVersionAuthorRole.STAFF;

  // The flow in the brief: customer submits, technician edits, customer edits back.
  const flow = [v(1, CUSTOMER), v(2, STAFF), v(3, CUSTOMER)];

  it('compares a technician edit against the customer submission', () => {
    expect(JobVersionService.baselineFor(flow, 2)).toBe(1);
  });

  it('compares a customer edit against the version the technician sent', () => {
    expect(JobVersionService.baselineFor(flow, 3)).toBe(2);
  });

  it('has no baseline for the original submission', () => {
    expect(JobVersionService.baselineFor(flow, 1)).toBeNull();
  });

  it('collapses two consecutive technician saves into one diff from the submission', () => {
    // Otherwise the customer would only be shown the second of the two edits.
    expect(JobVersionService.baselineFor([v(1, CUSTOMER), v(2, STAFF), v(3, STAFF)], 3)).toBe(1);
  });

  it('collapses two consecutive customer saves against what they were sent', () => {
    expect(JobVersionService.baselineFor([v(1, CUSTOMER), v(2, STAFF), v(3, CUSTOMER), v(4, CUSTOMER)], 4)).toBe(2);
  });

  it('returns null for a version that is not in the list', () => {
    expect(JobVersionService.baselineFor(flow, 99)).toBeNull();
  });
});

// ------------------------------------------------------------ saveWorkflows

// Real ObjectId strings: the service converts these, so a placeholder like
// 'job1' would fail inside BSON rather than exercising anything.
const JOB_ID = '000000000000000000000001';
const WF_ID = '000000000000000000000011';
const NODE_A_DB = '00000000000000000000000a';
const NODE_B_DB = '00000000000000000000000b';
const SVC_A = '0000000000000000000000aa';
const SVC_B = '0000000000000000000000bb';

const SERVICE_A = { _id: SVC_A, name: 'Gibson Assembly', price: 100, parameters: [{ id: 'vol', name: 'Volume', type: 'number' }] };
const SERVICE_B = { _id: SVC_B, name: 'Sequencing', price: 250, parameters: [] };

interface Harness {
  service: JobVersionService;
  nodes: any[];
  edges: any[];
  workflows: any[];
  versions: any[];
  job: any;
}

/** Minimal mongoose-shaped fakes over plain arrays. */
function buildHarness(options: { nodes?: any[]; customerCategory?: string } = {}): Harness {
  const nodes: any[] = options.nodes ?? [];
  const edges: any[] = [];
  const versions: any[] = [];
  const workflows: any[] = [{ _id: WF_ID, name: 'Workflow-1', nodes: nodes.map((n) => n._id), edges: [] }];
  const job: any = { _id: JOB_ID, sub: 'user-1', workflows: [WF_ID], customerCategory: options.customerCategory };

  let autoId = 0;
  // Also a valid ObjectId — newly created docs get their ids converted too.
  const nextId = (): string => String(++autoId).padStart(24, 'f');
  const exec = <T>(value: T): { exec: () => Promise<T> } => ({ exec: async (): Promise<T> => value });

  const applySet = (target: any, update: any): any => Object.assign(target, update?.$set ?? {});

  const nodeModel: any = {
    find: (q: any) => exec(nodes.filter((n) => q._id.$in.map(String).includes(String(n._id)))),
    findById: (id: string) => exec(nodes.find((n) => String(n._id) === String(id)) ?? null),
    findByIdAndUpdate: (id: string, update: any) => {
      const node = nodes.find((n) => String(n._id) === String(id));
      if (node) applySet(node, update);
      return exec(node ?? null);
    },
    create: async (doc: any) => {
      const created = { _id: nextId(), ...doc };
      nodes.push(created);
      return created;
    },
    deleteMany: (q: any) => {
      const ids = q._id.$in.map(String);
      for (let i = nodes.length - 1; i >= 0; i--) if (ids.includes(String(nodes[i]._id))) nodes.splice(i, 1);
      return exec(undefined);
    }
  };

  const edgeModel: any = {
    find: (q: any) => exec(edges.filter((e) => q._id.$in.map(String).includes(String(e._id)))),
    create: async (doc: any) => {
      const created = { _id: nextId(), ...doc };
      edges.push(created);
      return created;
    },
    deleteMany: (q: any) => {
      const ids = q._id.$in.map(String);
      for (let i = edges.length - 1; i >= 0; i--) if (ids.includes(String(edges[i]._id))) edges.splice(i, 1);
      return exec(undefined);
    }
  };

  const workflowModel: any = {
    findById: (id: string) => exec(workflows.find((w) => String(w._id) === String(id)) ?? null),
    findByIdAndUpdate: (id: string, update: any) => {
      const wf = workflows.find((w) => String(w._id) === String(id));
      if (wf) applySet(wf, update);
      return exec(wf ?? null);
    },
    findByIdAndDelete: (id: string) => {
      const i = workflows.findIndex((w) => String(w._id) === String(id));
      if (i >= 0) workflows.splice(i, 1);
      return exec(undefined);
    },
    create: async (doc: any) => {
      const created = { _id: nextId(), ...doc };
      workflows.push(created);
      return created;
    }
  };

  const jobModel: any = {
    findById: (id: string) => exec(String(id) === JOB_ID ? job : null),
    findByIdAndUpdate: (_id: string, update: any) => {
      applySet(job, update);
      return exec(job);
    }
  };

  const versionModel: any = {
    find: () => ({ sort: () => exec([...versions].sort((a, b) => a.versionNumber - b.versionNumber)) }),
    findOne: () => ({ sort: () => exec([...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null) }),
    create: async (doc: any) => {
      versions.push(doc);
      return doc;
    }
  };

  const dampLabServices: any = {
    findOneActive: async (id: string) => (String(id) === SVC_A ? SERVICE_A : String(id) === SVC_B ? SERVICE_B : null)
  };

  const service = new JobVersionService(versionModel, jobModel, workflowModel, nodeModel, edgeModel, dampLabServices);
  return { service, nodes, edges, workflows, versions, job };
}

const liveNode = (over: Partial<any> = {}): any => ({
  _id: NODE_A_DB,
  id: 'a',
  label: 'Gibson Assembly',
  service: SVC_A,
  additionalInstructions: '',
  formData: [{ id: 'vol', value: 10 }],
  reactNode: { position: { x: 10, y: 20 } },
  state: WorkflowNodeState.QUEUED,
  price: 100,
  usedInventory: [],
  assigneeId: undefined,
  completedSteps: [],
  ...over
});

const inputNode = (over: Record<string, any> = {}): any => ({
  id: 'a',
  label: 'Gibson Assembly',
  serviceId: SVC_A,
  formData: [{ id: 'vol', value: 10 }],
  additionalInstructions: '',
  position: { x: 10, y: 20 },
  ...over
});

const author = { role: JobVersionAuthorRole.STAFF, sub: 'tech-1', name: 'tech@bu.edu' };

describe('saveWorkflows — work already in flight', () => {
  it('refuses to delete a node the lab has started', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS })] });
    await expect(service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [], edges: [] }] } as any, author)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to delete a node that is holding inventory', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ usedInventory: ['inv-1'] })] });
    await expect(service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [], edges: [] }] } as any, author)).rejects.toThrow(/holding inventory/);
  });

  it('refuses to change the parameters of a node in progress', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS })] });
    await expect(service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode({ formData: [{ id: 'vol', value: 999 }] })], edges: [] }] } as any, author)).rejects.toThrow(
      /parameters changed/
    );
  });

  it('refuses to swap the service of a node in progress', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS })] });
    await expect(service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode({ serviceId: SVC_B })], edges: [] }] } as any, author)).rejects.toThrow(/change service/);
  });

  it('allows an in-progress node through untouched, so the rest of the graph stays editable', async () => {
    const { service, nodes } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS })] });
    await service.saveWorkflows(
      { jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode(), inputNode({ id: 'b', serviceId: SVC_B, label: 'Sequencing', formData: [] })], edges: [] }] } as any,
      author
    );
    expect(nodes).toHaveLength(2);
  });

  it('does not care about parameter ordering when checking an in-flight node', async () => {
    const { service } = buildHarness({
      nodes: [
        liveNode({
          state: WorkflowNodeState.IN_PROGRESS,
          formData: [
            { id: 'vol', value: 10 },
            { id: 'buf', value: 'TE' }
          ]
        })
      ]
    });
    await expect(
      service.saveWorkflows(
        {
          jobId: JOB_ID,
          workflows: [
            {
              workflowId: WF_ID,
              nodes: [
                inputNode({
                  formData: [
                    { id: 'buf', value: 'TE' },
                    { id: 'vol', value: 10 }
                  ]
                })
              ],
              edges: []
            }
          ]
        } as any,
        author
      )
    ).resolves.toBeDefined();
  });
});

describe('saveWorkflows — reconciliation', () => {
  it('preserves operational state on a node whose parameters were edited', async () => {
    const { service, nodes } = buildHarness({
      nodes: [liveNode({ assigneeId: 'staff-9', assigneeDisplayName: 'Sam', completedSteps: ['step-1', 'step-2'], startedAt: new Date('2026-08-01') })]
    });

    await service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode({ formData: [{ id: 'vol', value: 42 }] })], edges: [] }] } as any, author);

    const saved = nodes[0];
    expect(saved.formData).toEqual([{ id: 'vol', value: 42 }]);
    // None of this is the editor's to touch.
    expect(saved.assigneeId).toBe('staff-9');
    expect(saved.assigneeDisplayName).toBe('Sam');
    expect(saved.completedSteps).toEqual(['step-1', 'step-2']);
    expect(saved.startedAt).toEqual(new Date('2026-08-01'));
    expect(saved.state).toBe(WorkflowNodeState.QUEUED);
  });

  it('persists nothing it was not told about, so a UI-only flag can never leak', async () => {
    const { service, nodes } = buildHarness({ nodes: [liveNode()] });

    await service.saveWorkflows(
      {
        jobId: JOB_ID,
        workflows: [{ workflowId: WF_ID, nodes: [{ ...inputNode(), ghost: true, locked: true, diffKind: 'changed', state: WorkflowNodeState.COMPLETE }], edges: [] }]
      } as any,
      author
    );

    const saved = nodes[0];
    expect(saved.ghost).toBeUndefined();
    expect(saved.locked).toBeUndefined();
    expect(saved.diffKind).toBeUndefined();
    expect(saved.state).toBe(WorkflowNodeState.QUEUED);
  });

  it('creates a node the editor added, queued', async () => {
    const { service, nodes } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows(
      { jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode(), inputNode({ id: 'new1', serviceId: SVC_B, label: 'Sequencing', formData: [] })], edges: [] }] } as any,
      author
    );
    const added = nodes.find((n) => n.id === 'new1');
    expect(added).toBeDefined();
    expect(added.state).toBe(WorkflowNodeState.QUEUED);
  });

  it('deletes a queued node the editor removed', async () => {
    const { service, nodes } = buildHarness({ nodes: [liveNode(), liveNode({ id: 'b', _id: NODE_B_DB })] });
    await service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author);
    expect(nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('stores the position so the graph reopens where its author left it', async () => {
    const { service, nodes } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode({ position: { x: 640, y: 128 } })], edges: [] }] } as any, author);
    expect(nodes[0].reactNode.position).toEqual({ x: 640, y: 128 });
  });

  it('rejects a service that is not in the catalogue rather than writing a dangling node', async () => {
    const { service } = buildHarness({ nodes: [liveNode()] });
    await expect(service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode({ serviceId: 'nope' })], edges: [] }] } as any, author)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});

describe('saveWorkflows — pricing and versioning', () => {
  it("prices from the job's customer category, not the editing user's", async () => {
    const { service, nodes } = buildHarness({ nodes: [liveNode()], customerCategory: 'INTERNAL_CUSTOMERS' });
    const internalService = { ...SERVICE_A, pricing: { internal: 25, external: 400 } };
    (service as any).dampLabServices.findOneActive = async (): Promise<any> => internalService;

    await service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author);

    // A technician saved this, but the job belongs to an internal customer.
    expect(nodes[0].price).toBe(25);
  });

  it('appends exactly one version per save, numbered in sequence', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    const input = { jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any;

    await service.saveWorkflows(input, author);
    await service.saveWorkflows(input, { ...author, role: JobVersionAuthorRole.CUSTOMER });

    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(versions.map((v) => v.authorRole)).toEqual([JobVersionAuthorRole.STAFF, JobVersionAuthorRole.CUSTOMER]);
  });

  it('records the author and note on the version', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows({ jobId: JOB_ID, note: 'Bumped the volume', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author);
    expect(versions[0]).toMatchObject({ note: 'Bumped the volume', createdBy: 'tech-1', createdByName: 'tech@bu.edu' });
  });

  it('snapshots the saved graph, keyed by the client-side node id', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode({ formData: [{ id: 'vol', value: 7 }] })], edges: [] }] } as any, author);
    const snapshot = versions[0].workflows[0];
    expect(snapshot.nodes[0].id).toBe('a');
    expect(snapshot.nodes[0].formData).toEqual([{ id: 'vol', value: 7 }]);
  });

  it('rejects an unknown job', async () => {
    const { service } = buildHarness();
    await expect(service.saveWorkflows({ jobId: '0000000000000000000000ff', workflows: [] } as any, author)).rejects.toThrow(/not found/);
  });
});

describe('listByJob', () => {
  it('synthesizes v1 for a job submitted before versioning existed', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    const listed = await service.listByJob(JOB_ID);

    expect(listed).toHaveLength(1);
    expect(versions[0]).toMatchObject({ versionNumber: 1, authorRole: JobVersionAuthorRole.CUSTOMER, note: 'Original submission' });
    expect(versions[0].workflows[0].nodes[0].id).toBe('a');
  });

  it('does not synthesize a second time', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    await service.listByJob(JOB_ID);
    await service.listByJob(JOB_ID);
    expect(versions).toHaveLength(1);
  });

  it('returns nothing for a job that does not exist', async () => {
    const { service } = buildHarness();
    expect(await service.listByJob('0000000000000000000000ff')).toEqual([]);
  });
});

describe('saveWorkflows — catalogue drift against an in-flight node', () => {
  it('does not treat a parameter the catalogue gained as a user edit', async () => {
    // The editor always sends the *current* catalogue's parameter set, so a
    // parameter added since submission arrives with an empty value. That is not
    // something the user changed, and must not block the save.
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS, formData: [{ id: 'vol', value: 10 }] })] });
    await expect(
      service.saveWorkflows(
        {
          jobId: JOB_ID,
          workflows: [
            {
              workflowId: WF_ID,
              nodes: [
                inputNode({
                  formData: [
                    { id: 'vol', value: 10 },
                    { id: 'temp', value: null }
                  ]
                })
              ],
              edges: []
            }
          ]
        } as any,
        author
      )
    ).resolves.toBeDefined();
  });

  it('still blocks a real edit to a parameter on an in-flight node', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS, formData: [{ id: 'vol', value: 10 }] })] });
    await expect(
      service.saveWorkflows(
        {
          jobId: JOB_ID,
          workflows: [
            {
              workflowId: WF_ID,
              nodes: [
                inputNode({
                  formData: [
                    { id: 'vol', value: 10 },
                    { id: 'temp', value: 37 }
                  ]
                })
              ],
              edges: []
            }
          ]
        } as any,
        author
      )
    ).rejects.toThrow(/parameters changed/);
  });

  it('does not treat the universal run-count default as an edit', async () => {
    // Jobs submitted before the run-count entry existed store no __runCount, but
    // the editor always sends it as 1. Absent and 1 mean the same thing.
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS, formData: [{ id: 'vol', value: 10 }] })] });
    await expect(
      service.saveWorkflows(
        {
          jobId: JOB_ID,
          workflows: [
            {
              workflowId: WF_ID,
              nodes: [
                inputNode({
                  formData: [
                    { id: 'vol', value: 10 },
                    { id: '__runCount', value: 1 }
                  ]
                })
              ],
              edges: []
            }
          ]
        } as any,
        author
      )
    ).resolves.toBeDefined();
  });

  it('still blocks a real run-count change on an in-flight node', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS, formData: [{ id: 'vol', value: 10 }] })] });
    await expect(
      service.saveWorkflows(
        {
          jobId: JOB_ID,
          workflows: [
            {
              workflowId: WF_ID,
              nodes: [
                inputNode({
                  formData: [
                    { id: 'vol', value: 10 },
                    { id: '__runCount', value: 4 }
                  ]
                })
              ],
              edges: []
            }
          ]
        } as any,
        author
      )
    ).rejects.toThrow(/parameters changed/);
  });

  it('treats a number typed as text as the same value', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS, formData: [{ id: 'vol', value: 10 }] })] });
    await expect(
      service.saveWorkflows({ jobId: JOB_ID, workflows: [{ workflowId: WF_ID, nodes: [inputNode({ formData: [{ id: 'vol', value: '10' }] })], edges: [] }] } as any, author)
    ).resolves.toBeDefined();
  });
});
