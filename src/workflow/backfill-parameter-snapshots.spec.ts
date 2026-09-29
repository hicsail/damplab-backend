import { backfillParameterSnapshots, migrateStaffSubmittedJobs } from './backfill-parameter-snapshots';

class FakeCollection {
  updates = 0;
  constructor(readonly documents: any[]) {}
  find(): { toArray: () => Promise<any[]> } {
    return { toArray: async () => this.documents.map((d) => JSON.parse(JSON.stringify(d))) };
  }
  async updateOne(filter: any, update: any): Promise<void> {
    this.updates += 1;
    const doc = this.documents.find((d) => String(d._id) === String(filter._id));
    if (doc) {
      Object.assign(doc, update.$set ?? {});
      for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
    }
  }
}
const db = (fixtures: Record<string, any[]>): any => {
  const collections: Record<string, FakeCollection> = Object.fromEntries(Object.entries(fixtures).map(([k, v]) => [k, new FakeCollection(v)]));
  return { collections, collection: (name: string) => collections[name] ?? (collections[name] = new FakeCollection([])) };
};

const services = [
  { _id: 'svc1', name: 'Gibson', parameters: [{ id: 'vol', name: 'Volume', type: 'number' }] },
  { _id: 'svc2', name: 'Old', isDeleted: true, parameters: [{ id: 'kind', name: 'Kind', type: 'dropdown', options: [{ id: 'k1', name: 'Plasmid' }] }] }
];

describe('backfillParameterSnapshots (B23)', () => {
  const fixtures = (): Record<string, any[]> => ({
    damplabservices: services,
    workflownodes: [
      { _id: 'n1', service: 'svc1', formData: [{ id: 'vol', value: 5 }] },
      { _id: 'n2', service: 'svc2', formData: [{ id: 'kind', value: 'k1' }] },
      { _id: 'n3', service: 'svc1', formData: [{ id: 'vol', value: 9 }], parameterSnapshot: [{ id: 'vol', name: 'Kept', displayValue: '9' }] },
      { _id: 'n4', service: 'missing', formData: [{ id: 'x', value: 1 }] }
    ],
    job_versions: [{ _id: 'v1', workflows: [{ nodes: [{ id: 'a', serviceId: 'svc1', formData: [{ id: 'vol', value: 5 }] }] }] }]
  });

  it('fills nodes that lack a snapshot, including on soft-deleted services, and leaves others alone', async () => {
    const database = db(fixtures());
    const report = await backfillParameterSnapshots(database, { log: () => undefined });
    const nodes = database.collections.workflownodes.documents;
    expect(nodes[0].parameterSnapshot).toEqual([{ id: 'vol', name: 'Volume', type: 'number', displayValue: '5' }]);
    expect(nodes[1].parameterSnapshot).toEqual([{ id: 'kind', name: 'Kind', type: 'dropdown', displayValue: 'Plasmid' }]);
    expect(nodes[2].parameterSnapshot).toEqual([{ id: 'vol', name: 'Kept', displayValue: '9' }]);
    expect(nodes[3].parameterSnapshot).toBeUndefined();
    expect(report).toMatchObject({ nodesUpdated: 2, versionNodesUpdated: 1, missingService: ['n4'] });
    expect(database.collections.job_versions.documents[0].workflows[0].nodes[0].parameterSnapshot).toEqual([{ id: 'vol', name: 'Volume', type: 'number', displayValue: '5' }]);
  });

  it('changes nothing the second time', async () => {
    const database = db(fixtures());
    await backfillParameterSnapshots(database, { log: () => undefined });
    const before = { nodes: database.collections.workflownodes.updates, versions: database.collections.job_versions.updates };
    const second = await backfillParameterSnapshots(database, { log: () => undefined });
    expect(second).toMatchObject({ nodesUpdated: 0, versionNodesUpdated: 0 });
    expect({ nodes: database.collections.workflownodes.updates, versions: database.collections.job_versions.updates }).toEqual(before);
  });

  it('writes nothing on a dry run', async () => {
    const database = db(fixtures());
    const report = await backfillParameterSnapshots(database, { dryRun: true, log: () => undefined });
    expect(report.nodesUpdated).toBe(2);
    expect(database.collections.workflownodes.updates).toBe(0);
  });
});

describe('migrateStaffSubmittedJobs (B32)', () => {
  const jobs = (): any[] => [
    // Staff-submitted, client has an account.
    { _id: 'j1', sub: 'staff-sub', email: 'tech@bu.edu', username: 'tess', clientEmail: 'client@bu.edu' },
    // Staff-submitted, client has no account.
    { _id: 'j2', sub: 'staff-sub', email: 'tech@bu.edu', username: 'tess', clientEmail: 'new@bu.edu' },
    // Ordinary client-submitted job.
    { _id: 'j3', sub: 'c-sub', email: 'c@x.org', username: 'c' },
    // Already converted.
    { _id: 'j4', sub: 'client-kc', email: 'client@bu.edu', clientEmail: 'client@bu.edu', submittedBy: { sub: 'staff-sub', email: 'tech@bu.edu', name: 'tess' } },
    // clientEmail equals email (case aside): nothing to convert.
    { _id: 'j5', sub: 'c2', email: 'Same@X.org', clientEmail: 'same@x.org' },
    // Lookup will throw for this one.
    { _id: 'j6', sub: 'staff-sub', email: 'tech@bu.edu', username: 'tess', clientEmail: 'down@bu.edu' }
  ];
  const lookup = async (email: string): Promise<any> => {
    if (email === 'client@bu.edu') return { sub: 'client-kc', username: 'cara' };
    if (email === 'down@bu.edu') throw new Error('keycloak unreachable');
    return null;
  };

  it("moves the staff member to submittedBy and makes the job the client's", async () => {
    const database = db({ jobs: jobs() });
    const report = await migrateStaffSubmittedJobs(database, lookup, { log: () => undefined });
    const [j1, j2, j3, j4, j5, j6] = database.collections.jobs.documents;
    expect(j1).toEqual({ _id: 'j1', sub: 'client-kc', email: 'client@bu.edu', username: 'cara', clientEmail: 'client@bu.edu', submittedBy: { sub: 'staff-sub', email: 'tech@bu.edu', name: 'tess' } });
    expect(j2).toEqual({ _id: 'j2', email: 'new@bu.edu', clientEmail: 'new@bu.edu', submittedBy: { sub: 'staff-sub', email: 'tech@bu.edu', name: 'tess' } });
    expect(j3.submittedBy).toBeUndefined();
    expect(j4.sub).toBe('client-kc');
    expect(j5.submittedBy).toBeUndefined();
    expect(j6.sub).toBe('staff-sub');
    expect(report).toMatchObject({ converted: 2, failed: [{ id: 'j6' }] });
  });

  it('changes nothing the second time', async () => {
    const database = db({ jobs: jobs() });
    await migrateStaffSubmittedJobs(database, lookup, { log: () => undefined });
    const updates = database.collections.jobs.updates;
    const second = await migrateStaffSubmittedJobs(database, lookup, { log: () => undefined });
    expect(second.converted).toBe(0);
    expect(database.collections.jobs.updates).toBe(updates);
  });

  describe('repairing past client comments', () => {
    const comments = (): any[] => [
      // The client's own comment on j1, stamped with the technician's email by the old client page.
      { _id: 'c1', jobId: 'j1', authorType: 'CLIENT', author: 'Tech@BU.edu', content: 'from the client' },
      // A genuine staff comment by the same technician: not touched.
      { _id: 'c2', jobId: 'j1', authorType: 'STAFF', author: 'tech@bu.edu', content: 'from staff' },
      // A client comment with the client's own email: not touched.
      { _id: 'c3', jobId: 'j1', authorType: 'CLIENT', author: 'client@bu.edu', content: 'fine already' },
      // On a job converted by an earlier run (j4 already has submittedBy): still repaired.
      { _id: 'c4', jobId: 'j4', authorType: 'CLIENT', author: 'tech@bu.edu', content: 'old' },
      // On an ordinary job: never touched.
      { _id: 'c5', jobId: 'j3', authorType: 'CLIENT', author: 'tech@bu.edu', content: 'x' },
      // On a job whose lookup failed (unconverted, no submittedBy): left for the re-run.
      { _id: 'c6', jobId: 'j6', authorType: 'CLIENT', author: 'tech@bu.edu', content: 'x' }
    ];

    it('re-points CLIENT comments by the submitter to the client, case-insensitively, and counts them', async () => {
      const database = db({ jobs: jobs(), comments: comments() });
      const report = await migrateStaffSubmittedJobs(database, lookup, { log: () => undefined });
      const byId = Object.fromEntries(database.collections.comments.documents.map((c: any) => [c._id, c.author]));
      expect(byId).toEqual({ c1: 'client@bu.edu', c2: 'tech@bu.edu', c3: 'client@bu.edu', c4: 'client@bu.edu', c5: 'tech@bu.edu', c6: 'tech@bu.edu' });
      expect(report.commentsRepaired).toBe(2);
    });

    it('repairs nothing the second time', async () => {
      const database = db({ jobs: jobs(), comments: comments() });
      await migrateStaffSubmittedJobs(database, lookup, { log: () => undefined });
      const writes = database.collections.comments.updates;
      const second = await migrateStaffSubmittedJobs(database, lookup, { log: () => undefined });
      expect(second.commentsRepaired).toBe(0);
      expect(database.collections.comments.updates).toBe(writes);
    });

    it('counts but writes nothing on a dry run', async () => {
      const database = db({ jobs: jobs(), comments: comments() });
      const report = await migrateStaffSubmittedJobs(database, lookup, { dryRun: true, log: () => undefined });
      expect(report.commentsRepaired).toBe(2);
      expect(database.collections.comments.updates).toBe(0);
    });
  });

  it('writes nothing on a dry run', async () => {
    const database = db({ jobs: jobs() });
    const report = await migrateStaffSubmittedJobs(database, lookup, { dryRun: true, log: () => undefined });
    expect(report.converted).toBe(2);
    expect(database.collections.jobs.updates).toBe(0);
  });
});
