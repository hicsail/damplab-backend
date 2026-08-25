import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JobVersionService } from './job-version.service';
import { JobVersionAuthorRole, JobVersionSchema } from './job-version.model';
import { WorkflowNodeState } from '../workflow/models/node.model';
import { JobState } from '../job/job.model';

/**
 * The baseline rule is pure, so it is exercised directly. Everything else runs
 * against a small in-memory stand-in for the four collections `saveWorkflows`
 * touches — enough to pin the two properties that actually matter: that a save
 * never disturbs live lab state, and that it cannot persist a field it was not
 * told about.
 */

// -------------------------------------------------------------- version numbers

describe('version numbers', () => {
  it('encodes major.minor as major*1000 + minor', () => {
    expect(JobVersionService.encodeVersionNumber(0, 1)).toBe(1);
    expect(JobVersionService.encodeVersionNumber(1, 0)).toBe(1000);
    expect(JobVersionService.encodeVersionNumber(1, 2)).toBe(1002);
    expect(JobVersionService.encodeVersionNumber(2, 0)).toBe(2000);
  });

  it('decodes that encoding back', () => {
    expect(JobVersionService.decodeVersionNumber(1)).toEqual({ major: 0, minor: 1 });
    expect(JobVersionService.decodeVersionNumber(1002)).toEqual({ major: 1, minor: 2 });
  });

  it('labels encoded numbers as major.minor and legacy integers as themselves', () => {
    expect(JobVersionService.displayVersionLabel(1000)).toBe('1.0');
    expect(JobVersionService.displayVersionLabel(1002)).toBe('1.2');
    expect(JobVersionService.displayVersionLabel(3)).toBe('3');
  });

  it('starts a new job at 1.0 when the first row is a send-equivalent (original submission)', () => {
    expect(JobVersionService.nextVersionNumber(null, true)).toBe(1000);
  });

  it('bumps minor on the current major', () => {
    expect(JobVersionService.nextVersionNumber(1000, false)).toBe(1001);
    expect(JobVersionService.nextVersionNumber(1002, false)).toBe(1003);
  });

  it('bumps major and resets minor on Request Changes', () => {
    expect(JobVersionService.nextVersionNumber(1002, true)).toBe(2000);
  });

  it('keeps legacy integers consecutive, then jumps to 1.0 on the first major bump', () => {
    expect(JobVersionService.nextVersionNumber(3, false)).toBe(4);
    expect(JobVersionService.nextVersionNumber(3, true)).toBe(1000);
  });
});

describe('JobVersion operation index', () => {
  it('indexes only rows whose operationId is a string', () => {
    const operationIndex = JobVersionSchema.indexes().find(([keys]) => keys.jobId === 1 && keys.operationId === 1);

    expect(operationIndex?.[0]).toEqual({ jobId: 1, operationId: 1 });
    expect(operationIndex?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { operationId: { $type: 'string' } }
    });
    expect(operationIndex?.[1]).not.toHaveProperty('sparse');
  });
});

describe('customer visibility filter', () => {
  const row = (over: Record<string, unknown>): Record<string, unknown> & { versionNumber: number; authorRole: JobVersionAuthorRole; visibleToCustomer?: boolean | null } => ({
    versionNumber: 1000,
    authorRole: JobVersionAuthorRole.STAFF,
    visibleToCustomer: true,
    ...over
  });

  it('keeps published rows and customer-authored rows', () => {
    const versions = [
      row({ versionNumber: 1000, authorRole: JobVersionAuthorRole.CUSTOMER, visibleToCustomer: true }),
      row({ versionNumber: 1001, visibleToCustomer: false }),
      row({ versionNumber: 1002, authorRole: JobVersionAuthorRole.CUSTOMER, visibleToCustomer: true }),
      row({ versionNumber: 2000, visibleToCustomer: true, isEvent: true })
    ];
    expect(JobVersionService.filterVisibleToCustomer(versions).map((v) => v.versionNumber)).toEqual([1000, 1002, 2000]);
  });

  it('treats a missing visibleToCustomer as visible so legacy rows are not hidden', () => {
    const versions = [row({ versionNumber: 1, visibleToCustomer: undefined })];
    expect(JobVersionService.filterVisibleToCustomer(versions)).toHaveLength(1);
  });

  it('still shows a customer-authored row if visibleToCustomer were false', () => {
    const versions = [row({ authorRole: JobVersionAuthorRole.CUSTOMER, visibleToCustomer: false })];
    expect(JobVersionService.filterVisibleToCustomer(versions)).toHaveLength(1);
  });
});

describe('latestContentVersionNumber', () => {
  it('skips events and returns the newest content versionNumber', () => {
    const versions = [
      { versionNumber: 1000, isEvent: false },
      { versionNumber: 1001, isEvent: false },
      { versionNumber: 2000, isEvent: true }
    ];
    expect(JobVersionService.latestContentVersionNumber(versions)).toBe(1001);
  });

  it('is null when there are no versions', () => {
    expect(JobVersionService.latestContentVersionNumber([])).toBeNull();
  });
});

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

  it('never baselines against a state-change event', () => {
    // An event version copies its predecessor's graph verbatim, so baselining
    // against one reports "nothing changed" and hides the edit it followed —
    // e.g. closing a job right after the customer edited it.
    const ev = (versionNumber: number, authorRole: JobVersionAuthorRole): any => ({ versionNumber, authorRole, isEvent: true });
    const withEvent = [v(1, CUSTOMER), v(2, STAFF), ev(3, STAFF), v(4, CUSTOMER)];
    expect(JobVersionService.baselineFor(withEvent, 4)).toBe(2);
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
  raceVersionCreateOnce: () => void;
}

/** Minimal mongoose-shaped fakes over plain arrays. */
function buildHarness(options: { nodes?: any[]; customerCategory?: string } = {}): Harness {
  const nodes: any[] = options.nodes ?? [];
  const edges: any[] = [];
  const versions: any[] = [];
  const workflows: any[] = [{ _id: WF_ID, name: 'Workflow-1', nodes: nodes.map((n) => n._id), edges: [] }];
  const job: any = { _id: JOB_ID, sub: 'user-1', workflows: [WF_ID], customerCategory: options.customerCategory };

  let autoId = 0;
  let versionCreateRaces = 0;
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

  const matchingVersions = (query: any = {}): any[] =>
    versions.filter((version) => {
      if (query.jobId !== undefined && version.jobId !== query.jobId) return false;
      if (query.versionNumber !== undefined && version.versionNumber !== query.versionNumber) return false;
      if (query.operationId !== undefined && version.operationId !== query.operationId) return false;
      if (query.isEvent?.$ne !== undefined && version.isEvent === query.isEvent.$ne) return false;
      return true;
    });
  const versionModel: any = {
    find: (query: any = {}) => ({ sort: () => exec([...matchingVersions(query)].sort((a, b) => a.versionNumber - b.versionNumber)) }),
    findOne: (query: any = {}) => ({
      sort: () => exec([...matchingVersions(query)].sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null),
      exec: async () => matchingVersions(query)[0] ?? null
    }),
    findOneAndUpdate: (query: any, update: any) => {
      const version = matchingVersions(query)[0] ?? null;
      if (version) Object.assign(version, update.$set ?? {});
      return exec(version);
    },
    create: async (doc: any) => {
      versions.push(doc);
      if (versionCreateRaces > 0) {
        versionCreateRaces -= 1;
        const error: any = new Error('duplicate version operation');
        error.code = 11000;
        throw error;
      }
      return doc;
    }
  };

  const dampLabServices: any = {
    findOneActive: async (id: string) => (String(id) === SVC_A ? SERVICE_A : String(id) === SVC_B ? SERVICE_B : null)
  };

  const service = new JobVersionService(versionModel, jobModel, workflowModel, nodeModel, edgeModel, dampLabServices);
  return {
    service,
    nodes,
    edges,
    workflows,
    versions,
    job,
    raceVersionCreateOnce: (): void => {
      versionCreateRaces += 1;
    }
  };
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
    await expect(service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [], edges: [] }] } as any, author)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to delete a node that is holding inventory', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ usedInventory: ['inv-1'] })] });
    await expect(service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [], edges: [] }] } as any, author)).rejects.toThrow(/holding inventory/);
  });

  it('refuses to change the parameters of a node in progress', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS })] });
    await expect(
      service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode({ formData: [{ id: 'vol', value: 999 }] })], edges: [] }] } as any, author)
    ).rejects.toThrow(/parameters changed/);
  });

  it('refuses to swap the service of a node in progress', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS })] });
    await expect(service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode({ serviceId: SVC_B })], edges: [] }] } as any, author)).rejects.toThrow(
      /change service/
    );
  });

  it('allows an in-progress node through untouched, so the rest of the graph stays editable', async () => {
    const { service, nodes } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS })] });
    await service.saveWorkflows(
      { jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode(), inputNode({ id: 'b', serviceId: SVC_B, label: 'Sequencing', formData: [] })], edges: [] }] } as any,
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
          note: 'edited',
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

    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode({ formData: [{ id: 'vol', value: 42 }] })], edges: [] }] } as any, author);

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
        note: 'edited',
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
      { jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode(), inputNode({ id: 'new1', serviceId: SVC_B, label: 'Sequencing', formData: [] })], edges: [] }] } as any,
      author
    );
    const added = nodes.find((n) => n.id === 'new1');
    expect(added).toBeDefined();
    expect(added.state).toBe(WorkflowNodeState.QUEUED);
  });

  it('deletes a queued node the editor removed', async () => {
    const { service, nodes } = buildHarness({ nodes: [liveNode(), liveNode({ id: 'b', _id: NODE_B_DB })] });
    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author);
    expect(nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('stores the position so the graph reopens where its author left it', async () => {
    const { service, nodes } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode({ position: { x: 640, y: 128 } })], edges: [] }] } as any, author);
    expect(nodes[0].reactNode.position).toEqual({ x: 640, y: 128 });
  });

  // Trees are recomputed from connectivity on every save, so nodes migrate
  // between them constantly. Deciding deletion per tree used to delete a node
  // that had merely moved, leaving an edge pointing at nothing — which made the
  // whole job unreadable, because WorkflowEdge.source throws on a missing node.
  it('keeps both nodes when deleting an edge splits one tree into two', async () => {
    const { service, nodes, edges } = buildHarness({ nodes: [liveNode(), liveNode({ id: 'b', _id: NODE_B_DB })] });

    // a and b were connected; the edge is gone, so the editor sends two trees —
    // the original workflow keeps 'a', and 'b' arrives as a brand new tree.
    await service.saveWorkflows(
      {
        jobId: JOB_ID,
        note: 'removed the connection',
        workflows: [
          { workflowId: WF_ID, nodes: [inputNode()], edges: [] },
          { nodes: [inputNode({ id: 'b' })], edges: [] }
        ]
      } as any,
      author
    );

    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(edges).toHaveLength(0);
  });

  it('keeps every node when adding an edge merges two trees into one', async () => {
    const { service, nodes, workflows, edges, job } = buildHarness({ nodes: [liveNode(), liveNode({ id: 'b', _id: NODE_B_DB })] });
    // Start from two separate trees, the second holding 'b'.
    const SECOND_WF = '000000000000000000000012';
    workflows[0].nodes = [NODE_A_DB];
    workflows.push({ _id: SECOND_WF, name: 'Workflow-2', nodes: [NODE_B_DB], edges: [] });
    job.workflows = [WF_ID, SECOND_WF];

    await service.saveWorkflows(
      {
        jobId: JOB_ID,
        note: 'connected them',
        workflows: [{ workflowId: WF_ID, nodes: [inputNode(), inputNode({ id: 'b' })], edges: [{ id: 'e1', source: 'a', target: 'b' }] }]
      } as any,
      author
    );

    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    // The surviving edge must point at nodes that still exist.
    expect(edges).toHaveLength(1);
    const present = new Set(nodes.map((n) => String(n._id)));
    expect(present.has(String(edges[0].source))).toBe(true);
    expect(present.has(String(edges[0].target))).toBe(true);
  });

  it('rejects a service that is not in the catalogue rather than writing a dangling node', async () => {
    const { service } = buildHarness({ nodes: [liveNode()] });
    await expect(
      service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode({ serviceId: 'nope' })], edges: [] }] } as any, author)
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('saveWorkflows — pricing and versioning', () => {
  it("prices from the job's customer category, not the editing user's", async () => {
    const { service, nodes } = buildHarness({ nodes: [liveNode()], customerCategory: 'INTERNAL_CUSTOMERS' });
    const internalService = { ...SERVICE_A, pricing: { internal: 25, external: 400 } };
    (service as any).dampLabServices.findOneActive = async (): Promise<any> => internalService;

    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author);

    // A technician saved this, but the job belongs to an internal customer.
    expect(nodes[0].price).toBe(25);
  });

  it('appends exactly one version per save, numbered in sequence', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    const input = { jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any;

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
    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode({ formData: [{ id: 'vol', value: 7 }] })], edges: [] }] } as any, author);
    const snapshot = versions[0].workflows[0];
    expect(snapshot.nodes[0].id).toBe('a');
    expect(snapshot.nodes[0].formData).toEqual([{ id: 'vol', value: 7 }]);
  });

  it('rejects an unknown job', async () => {
    const { service } = buildHarness();
    await expect(service.saveWorkflows({ jobId: '0000000000000000000000ff', workflows: [] } as any, author)).rejects.toThrow(/not found/);
  });

  it('rejects a save whose note is only whitespace', async () => {
    // The schema stops a missing note; this is the one that would otherwise slip
    // through typed and still leave the history entry unlabelled.
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    await expect(service.saveWorkflows({ jobId: JOB_ID, note: '  ', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author)).rejects.toBeInstanceOf(BadRequestException);
    // Rejected before anything was written.
    expect(versions).toHaveLength(0);
  });
});

describe('visibility and major bumps on write', () => {
  it('hides a staff editor save from the customer', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author);
    expect(versions[0].visibleToCustomer).toBe(false);
    expect(versions[0].versionNumber).toBe(1);
  });

  it('shows a customer editor save', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, { ...author, role: JobVersionAuthorRole.CUSTOMER });
    expect(versions[0].visibleToCustomer).toBe(true);
  });

  it('bumps major on Request Changes and marks that row visible', async () => {
    const { service, versions, job } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author);
    await service.appendStateEvent(job, JobState.CHANGES_REQUESTED, author, 'Changes requested');
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 1000]);
    expect(versions[1]).toMatchObject({
      isEvent: true,
      visibleToCustomer: true,
      jobState: JobState.CHANGES_REQUESTED
    });
  });

  it('does not bump major on resubmit', async () => {
    const { service, versions, job } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author);
    await service.appendStateEvent(job, JobState.CHANGES_REQUESTED, author, 'Changes requested');
    await service.appendStateEvent(job, JobState.SUBMITTED, { ...author, role: JobVersionAuthorRole.CUSTOMER }, 'Resubmitted');
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 1000, 1001]);
    expect(versions[2]).toMatchObject({ visibleToCustomer: true, jobState: JobState.SUBMITTED, isEvent: true });
  });

  it('backfills the original submission as 1.0 and visible', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    await service.listByJob(JOB_ID);
    expect(versions[0]).toMatchObject({
      versionNumber: 1000,
      visibleToCustomer: true,
      note: 'Original submission',
      authorRole: JobVersionAuthorRole.CUSTOMER
    });
  });
});

describe('listByJob', () => {
  it('synthesizes v1 for a job submitted before versioning existed', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    const listed = await service.listByJob(JOB_ID);

    expect(listed).toHaveLength(1);
    expect(versions[0]).toMatchObject({ versionNumber: 1000, authorRole: JobVersionAuthorRole.CUSTOMER, note: 'Original submission' });
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

  it('leaves the backfilled v1 without a job state, since none was recorded', async () => {
    // The state chip has nothing to show for it, which is the intended reading —
    // better than inventing a state the job may not have been in at the time.
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    await service.listByJob(JOB_ID);
    expect(versions[0].jobState).toBeUndefined();
  });
});

describe('appendStateEvent', () => {
  const stateAuthor = { role: JobVersionAuthorRole.CUSTOMER, sub: 'client-1', name: 'jane@bu.edu' };

  it('backfills the original submission before recording the event', async () => {
    // On a job submitted before versioning existed, writing the event straight in
    // would take version 1 — and listByJob only backfills when it finds *no*
    // versions, so the original submission would be lost for good and the
    // history would open with "Resubmitted" against nothing.
    const { service, versions, job } = buildHarness({ nodes: [liveNode()] });
    await service.appendStateEvent(job, JobState.SUBMITTED, stateAuthor, 'Resubmitted');

    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ versionNumber: 1000, note: 'Original submission' });
    expect(versions[1]).toMatchObject({ versionNumber: 1001, note: 'Resubmitted', jobState: JobState.SUBMITTED, authorRole: JobVersionAuthorRole.CUSTOMER });
  });

  it('snapshots the graph unchanged, so the entry diffs empty', async () => {
    // The point of an event version: it marks that something happened without
    // claiming the workflow changed.
    const { service, versions, job } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author);
    await service.appendStateEvent(job, JobState.CHANGES_REQUESTED, stateAuthor, 'Changes requested');

    const [saved, event] = versions;
    expect(versions).toHaveLength(2);
    expect(event.workflows).toEqual(saved.workflows);
    expect(event.note).toBe('Changes requested');
  });

  it('writes nothing for a job with no workflows to snapshot', async () => {
    const { service, versions, job } = buildHarness();
    job.workflows = [];
    expect(await service.appendStateEvent(job, JobState.CLOSED, stateAuthor, 'Closed')).toBeNull();
    expect(versions).toHaveLength(0);
  });

  it('returns the existing event when the same operationId is retried', async () => {
    const { service, versions, job } = buildHarness({ nodes: [liveNode()] });

    const first = await service.appendStateEvent(job, JobState.SUBMITTED, stateAuthor, 'Resubmitted', 'operation-1');
    const second = await service.appendStateEvent(job, JobState.SUBMITTED, stateAuthor, 'Resubmitted', 'operation-1');

    expect(second).toBe(first);
    expect(versions.filter((version) => version.operationId === 'operation-1')).toHaveLength(1);
  });

  it('returns the concurrent event winner when create loses a duplicate-key race', async () => {
    const { service, versions, job, raceVersionCreateOnce } = buildHarness({ nodes: [liveNode()] });
    await service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode()], edges: [] }] } as any, author);
    raceVersionCreateOnce();

    const result = await service.appendStateEvent(job, JobState.SUBMITTED, stateAuthor, 'Resubmitted', 'operation-race');

    expect(result).toBe(versions.find((version) => version.operationId === 'operation-race'));
    expect(versions.filter((version) => version.operationId === 'operation-race')).toHaveLength(1);
  });
});

describe('content version publication', () => {
  it('gets the latest non-event content version directly', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    versions.push(
      { jobId: JOB_ID, versionNumber: 1000, isEvent: false, workflows: [{ name: 'old' }] },
      { jobId: JOB_ID, versionNumber: 1001, isEvent: false, workflows: [{ name: 'latest' }] },
      { jobId: JOB_ID, versionNumber: 2000, isEvent: true, workflows: [{ name: 'event' }] }
    );

    await expect(service.getLatestContentVersion(JOB_ID)).resolves.toMatchObject({
      versionNumber: 1001,
      workflows: [{ name: 'latest' }]
    });
  });

  it('publishes a hidden staff version by changing envelope metadata only', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    const workflows = [{ name: 'immutable', nodes: [{ id: 'a' }], edges: [] }];
    versions.push({
      jobId: JOB_ID,
      versionNumber: 1001,
      authorRole: JobVersionAuthorRole.STAFF,
      visibleToCustomer: false,
      workflows,
      note: 'staff draft'
    });

    const published = await service.publishVersion(JOB_ID, 1001, 'staff-1');

    expect(published).toMatchObject({
      visibleToCustomer: true,
      publishedBy: 'staff-1',
      note: 'staff draft'
    });
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(published.workflows).toEqual(workflows);
  });

  it('leaves an already customer-visible version unchanged when published repeatedly', async () => {
    const { service, versions } = buildHarness({ nodes: [liveNode()] });
    const visible = {
      jobId: JOB_ID,
      versionNumber: 1000,
      authorRole: JobVersionAuthorRole.CUSTOMER,
      visibleToCustomer: true,
      workflows: [{ name: 'customer', nodes: [], edges: [] }]
    };
    versions.push(visible);

    const first = await service.publishVersion(JOB_ID, 1000, 'staff-1');
    const second = await service.publishVersion(JOB_ID, 1000, 'staff-2');

    expect(first).toBe(visible);
    expect(second).toBe(visible);
    expect(visible).not.toHaveProperty('publishedAt');
    expect(visible).not.toHaveProperty('publishedBy');
  });

  it('rejects publication of a version that is not on the job', async () => {
    const { service } = buildHarness({ nodes: [liveNode()] });
    await expect(service.publishVersion(JOB_ID, 9999, 'staff-1')).rejects.toBeInstanceOf(NotFoundException);
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
          note: 'edited',
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
          note: 'edited',
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
          note: 'edited',
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
          note: 'edited',
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
      service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode({ formData: [{ id: 'vol', value: '10' }] })], edges: [] }] } as any, author)
    ).resolves.toBeDefined();
  });

  it('treats nested object parameter key order as the same value', async () => {
    const stored = { alpha: 1, beta: { y: 2, z: 3 } };
    const submitted = { beta: { z: 3, y: 2 }, alpha: 1 };
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS, formData: [{ id: 'config', value: stored }] })] });
    await expect(
      service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode({ formData: [{ id: 'config', value: submitted }] })], edges: [] }] } as any, author)
    ).resolves.toBeDefined();
  });

  it('blocks nested object parameter content changes on an in-flight node', async () => {
    const { service } = buildHarness({ nodes: [liveNode({ state: WorkflowNodeState.IN_PROGRESS, formData: [{ id: 'config', value: { a: 1 } }] })] });
    await expect(
      service.saveWorkflows({ jobId: JOB_ID, note: 'edited', workflows: [{ workflowId: WF_ID, nodes: [inputNode({ formData: [{ id: 'config', value: { a: 2 } }] })], edges: [] }] } as any, author)
    ).rejects.toThrow(/parameters changed/);
  });
});
