import { migrateJobContractFlow, verifyJobContractFlow } from './migrate-job-contract-flow';
import { CustomerActionRequired, JobState } from './job.model';
import { SOWStatus } from '../sow/sow.model';

class FakeCollection {
  writes = 0;

  constructor(readonly documents: any[]) {}

  find(): { toArray: () => Promise<any[]> } {
    return { toArray: async () => this.documents.map((document) => ({ ...document })) };
  }

  async bulkWrite(operations: any[]): Promise<void> {
    this.writes += operations.length;
    for (const operation of operations) {
      const { filter, update } = operation.updateOne;
      const document = this.documents.find((candidate) => String(candidate._id) === String(filter._id));
      if (!document) continue;
      Object.assign(document, update.$set ?? {});
      for (const key of Object.keys(update.$unset ?? {})) delete document[key];
    }
  }
}

class FakeDb {
  readonly collections: Record<string, FakeCollection>;

  constructor(fixtureSet: Record<string, any[]>) {
    this.collections = Object.fromEntries(Object.entries(fixtureSet).map(([name, documents]) => [name, new FakeCollection(documents)]));
  }

  collection(name: string): FakeCollection {
    return this.collections[name] ?? (this.collections[name] = new FakeCollection([]));
  }
}

const CATEGORY = 'INTERNAL_CUSTOMERS';

const contentVersion = (id: string, jobId: string, versionNumber: number, createdAt: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  _id: id,
  jobId,
  versionNumber,
  isEvent: false,
  workflows: [{ workflowId: 'wf-1', name: id, nodes: [], edges: [] }],
  createdAt: new Date(createdAt),
  authorRole: 'CUSTOMER',
  visibleToCustomer: true,
  ...extra
});

function fixtures(): FakeDb {
  return new FakeDb({
    jobs: [
      // Classification of the three asks CHANGES_REQUESTED used to conflate.
      { _id: 'edit', state: JobState.CHANGES_REQUESTED, customerEditingEnabled: true },
      { _id: 'approve', state: JobState.CHANGES_REQUESTED, customerEditingEnabled: false },
      { _id: 'reply', state: JobState.CHANGES_REQUESTED, customerEditingEnabled: false, customerActionRequired: 'LEGACY' },
      { _id: 'submitted', state: JobState.SUBMITTED, customerEditingEnabled: true },
      { _id: 'explicit', state: JobState.CHANGES_REQUESTED, customerEditingEnabled: false, customerActionRequired: CustomerActionRequired.REPLY },

      // Accepted before the version number was recorded. One per derivation rule.
      {
        _id: 'dated',
        state: JobState.ACCEPTED,
        customerCategory: CATEGORY,
        customerEditingEnabled: true,
        acceptedBillingFingerprint: 'billing-dated',
        acceptedAt: new Date('2026-03-10T00:00:00.000Z'),
        acceptedBy: 'staff-1'
      },
      { _id: 'evented', state: JobState.ACCEPTED, customerCategory: CATEGORY, acceptedBillingFingerprint: 'billing-evented' },
      { _id: 'latest', state: JobState.ACCEPTED, customerCategory: CATEGORY, acceptedBillingFingerprint: 'billing-latest' },

      // Cannot be completed here; staff must re-accept.
      { _id: 'nobilling', state: JobState.ACCEPTED, customerCategory: CATEGORY },
      { _id: 'noversions', state: JobState.ACCEPTED, customerCategory: CATEGORY, acceptedBillingFingerprint: 'billing-none' },

      // Already accepted through the new flow — never recomputed.
      { _id: 'already', state: JobState.ACCEPTED, customerCategory: CATEGORY, acceptedBillingFingerprint: 'billing-already', acceptedJobVersionNumber: 4000 }
    ],
    job_versions: [
      { _id: 'a1', jobId: 'approve', versionNumber: 10, isEvent: true, note: 'Clarification requested' },
      { _id: 'a2', jobId: 'approve', versionNumber: 11, isEvent: true, note: 'Approval requested' },
      { _id: 'r1', jobId: 'reply', versionNumber: 20, isEvent: true, note: 'Approval requested' },
      { _id: 'r2', jobId: 'reply', versionNumber: 21, isEvent: true, note: 'Workflow edits requested' },
      // Content below each handover event, so a baseline can be derived.
      contentVersion('ac1', 'approve', 9, '2026-03-01T00:00:00.000Z'),
      contentVersion('rc1', 'reply', 19, '2026-03-01T00:00:00.000Z'),
      contentVersion('ec1', 'edit', 5, '2026-03-01T00:00:00.000Z'),

      // 'dated': v1001 predates acceptedAt, v1002 comes after it.
      contentVersion('d1', 'dated', 1001, '2026-03-01T00:00:00.000Z'),
      contentVersion('d2', 'dated', 1002, '2026-03-20T00:00:00.000Z'),

      // 'evented': no acceptedAt; the ACCEPTED event sits above v2001, below v2600.
      contentVersion('e1', 'evented', 2001, '2026-03-01T00:00:00.000Z', { authorRole: 'STAFF', visibleToCustomer: false }),
      { _id: 'e-evt', jobId: 'evented', versionNumber: 2500, isEvent: true, jobState: JobState.ACCEPTED, note: 'Accepted' },
      contentVersion('e2', 'evented', 2600, '2026-04-01T00:00:00.000Z'),

      // 'latest': no acceptedAt and no acceptance event.
      contentVersion('l1', 'latest', 3001, '2026-03-01T00:00:00.000Z'),
      contentVersion('l2', 'latest', 3002, '2026-03-05T00:00:00.000Z'),

      contentVersion('nb1', 'nobilling', 5001, '2026-03-01T00:00:00.000Z'),
      contentVersion('al1', 'already', 4000, '2026-03-01T00:00:00.000Z')
    ],
    sows: [
      { _id: 'draft-sow', jobId: 'dated', status: SOWStatus.DRAFT, currentVersionNumber: 1, activeVersionNumber: 500 },
      { _id: 'sent-sow', jobId: 'latest', status: SOWStatus.SENT, currentVersionNumber: 2, activeVersionNumber: 2 },
      { _id: 'orphan-sow', jobId: 'noversions', status: SOWStatus.DRAFT, currentVersionNumber: 7, activeVersionNumber: 0 }
    ],
    sow_versions: [
      { _id: 'draft-v1', sowId: 'draft-sow', versionNumber: 1, status: SOWStatus.DRAFT },
      { _id: 'draft-active-v500', sowId: 'draft-sow', versionNumber: 500, status: SOWStatus.SENT },
      { _id: 'sent-v2', sowId: 'sent-sow', versionNumber: 2, status: SOWStatus.SENT, sourceJobVersionNumber: 4 },
      { _id: 'signed-old', sowId: 'sent-sow', versionNumber: 1, status: SOWStatus.SIGNED },
      { _id: 'orphan-v7', sowId: 'orphan-sow', versionNumber: 7, status: SOWStatus.DRAFT },
      { _id: 'final-linked', sowId: 'other', versionNumber: 3, status: SOWStatus.FINAL, sourceJobVersionNumber: 3 }
    ]
  });
}

const jobsById = (db: FakeDb): Map<string, any> => new Map(db.collection('jobs').documents.map((job) => [job._id, job]));

describe('migrateJobContractFlow', () => {
  it('dry-runs every classification and backfill without writing', async () => {
    const db = fixtures();
    // structuredClone, not a JSON round-trip: these fixtures carry Dates, and
    // JSON would turn them into strings on one side of the comparison only.
    const before = structuredClone(db.collection('jobs').documents);

    const report = await migrateJobContractFlow(db as any, { dryRun: true });

    expect(db.collection('jobs').documents).toEqual(before);
    expect(db.collection('jobs').writes).toBe(0);
    expect(db.collection('job_versions').writes).toBe(0);
    expect(db.collection('sow_versions').writes).toBe(0);
    expect(report).toMatchObject({
      scannedJobs: 11,
      classifiedEditWorkflow: 1,
      classifiedApproveWorkflow: 1,
      classifiedReply: 1,
      preservedValidActions: 1,
      acceptedJobsMissingExactAcceptance: 5,
      acceptedJobsBackfilled: 3,
      acceptedByAcceptedAt: 1,
      acceptedByAcceptanceEvent: 1,
      acceptedByLatestContent: 1,
      acceptedJobsMissingBillingFingerprint: 1,
      acceptedJobsWithNoContentVersion: 1,
      acceptedVersionsPublished: 1
    });
    expect(report.failed).toHaveLength(2);
  });

  it('classifies customer actions from the latest event note and preserves explicit ones', async () => {
    const db = fixtures();

    await migrateJobContractFlow(db as any);

    const byId = jobsById(db);
    expect(byId.get('edit')).toMatchObject({ customerActionRequired: CustomerActionRequired.EDIT_WORKFLOW });
    expect(byId.get('approve')).toMatchObject({ customerActionRequired: CustomerActionRequired.APPROVE_WORKFLOW });
    expect(byId.get('reply')).toMatchObject({ customerActionRequired: CustomerActionRequired.REPLY });
    expect(byId.get('submitted')).toMatchObject({ customerActionRequired: null });
    expect(byId.get('explicit')).toMatchObject({ customerActionRequired: CustomerActionRequired.REPLY });
  });

  // The flag is gone; the requested action now carries what it used to say.
  it('clears customerEditingEnabled from every job', async () => {
    const db = fixtures();

    await migrateJobContractFlow(db as any);

    for (const job of db.collection('jobs').documents) {
      expect(job).not.toHaveProperty('customerEditingEnabled');
    }
  });

  it('stamps the newest content version that predates acceptedAt', async () => {
    const db = fixtures();
    await migrateJobContractFlow(db as any);
    expect(jobsById(db).get('dated')).toMatchObject({ acceptedJobVersionNumber: 1001 });
  });

  it('falls back to the acceptance event position, then to the latest content version', async () => {
    const db = fixtures();
    await migrateJobContractFlow(db as any);

    const byId = jobsById(db);
    expect(byId.get('evented')).toMatchObject({ acceptedJobVersionNumber: 2001 });
    expect(byId.get('latest')).toMatchObject({ acceptedJobVersionNumber: 3002 });
  });

  it('records the handover baseline a withdrawal would restore', async () => {
    const db = fixtures();

    const report = await migrateJobContractFlow(db as any);

    const byId = jobsById(db);
    // The newest content version at or below the handover event.
    expect(byId.get('approve')).toMatchObject({ handoverVersionNumber: 9 });
    expect(byId.get('reply')).toMatchObject({ handoverVersionNumber: 19 });
    // No handover event: falls back to the newest content version.
    expect(byId.get('edit')).toMatchObject({ handoverVersionNumber: 5 });
    // Jobs the customer does not hold get none.
    expect(byId.get('submitted').handoverVersionNumber).toBeUndefined();
    expect(report.handoverBaselinesBackfilled).toBe(3);
  });

  it('reports a job with the customer that has no version to fall back to', async () => {
    const db = new FakeDb({ jobs: [{ _id: 'bare', state: JobState.CHANGES_REQUESTED }], job_versions: [], sows: [], sow_versions: [] });

    const report = await migrateJobContractFlow(db as any);

    expect(report.handoverBaselinesUnavailable).toBe(1);
    expect(db.collection('jobs').documents[0].handoverVersionNumber).toBeUndefined();
  });

  it('publishes a staff-authored accepted version the customer could not see', async () => {
    const db = fixtures();

    await migrateJobContractFlow(db as any);

    const published = db.collection('job_versions').documents.find((version) => version._id === 'e1');
    expect(published).toMatchObject({ visibleToCustomer: true, publishedBy: 'migration' });
    expect(published.publishedAt).toBeInstanceOf(Date);
    // A customer-authored version was already visible and is left alone.
    expect(db.collection('job_versions').documents.find((version) => version._id === 'd1')).not.toHaveProperty('publishedBy');
  });

  it('never recomputes an acceptance recorded through the new flow', async () => {
    const db = fixtures();
    await migrateJobContractFlow(db as any);
    expect(jobsById(db).get('already')).toMatchObject({ acceptedJobVersionNumber: 4000 });
  });

  it('reports the jobs it cannot complete instead of stamping a half acceptance', async () => {
    const db = fixtures();

    const report = await migrateJobContractFlow(db as any);

    const byId = jobsById(db);
    expect(byId.get('nobilling')).not.toHaveProperty('acceptedJobVersionNumber');
    expect(byId.get('noversions')).not.toHaveProperty('acceptedJobVersionNumber');
    expect(report.failed).toEqual([expect.stringContaining('nobilling: accepted with no billing fingerprint'), expect.stringContaining('noversions: accepted with no content version')]);
  });

  it('backfills the source only on the current and active SOW rows of a stamped job', async () => {
    const db = fixtures();

    const report = await migrateJobContractFlow(db as any);

    const byId = new Map(db.collection('sow_versions').documents.map((version) => [version._id, version]));
    expect(byId.get('draft-v1')).toMatchObject({ sourceJobVersionNumber: 1001 });
    expect(byId.get('draft-active-v500')).toMatchObject({ sourceJobVersionNumber: 1001 });
    // Already carries a source: never overwritten.
    expect(byId.get('sent-v2')).toMatchObject({ sourceJobVersionNumber: 4 });
    // Historical rows are audited, never written.
    expect(byId.get('signed-old')).not.toHaveProperty('sourceJobVersionNumber');
    // The SOW of a job that could not be stamped is left as it was.
    expect(byId.get('orphan-v7')).not.toHaveProperty('sourceJobVersionNumber');
    expect(report).toMatchObject({ sowVersionsSourceBackfilled: 2, sowVersionsStillMissingSource: 1 });
  });

  it('is idempotent', async () => {
    const db = fixtures();

    const first = await migrateJobContractFlow(db as any);
    expect(first.writes).toBeGreaterThan(0);

    const second = await migrateJobContractFlow(db as any);
    expect(second.writes).toBe(0);
    expect(second.acceptedJobsBackfilled).toBe(0);
    expect(second.handoverBaselinesBackfilled).toBe(0);
    expect(second.sowVersionsSourceBackfilled).toBe(0);
  });
});

describe('verifyJobContractFlow', () => {
  it('names every record the contract gate would block', async () => {
    const db = fixtures();

    const before = await verifyJobContractFlow(db as any);

    expect(before.acceptedJobsMissingExactAcceptance).toEqual(expect.arrayContaining(['dated', 'evented', 'latest', 'nobilling', 'noversions']));
    expect(before.acceptedJobsMissingBillingFingerprint).toEqual(['nobilling']);
    expect(before.changesRequestedJobsWithNoAction).toEqual(expect.arrayContaining(['edit', 'approve', 'reply']));
    expect(before.changesRequestedJobsWithNoHandover).toEqual(expect.arrayContaining(['edit', 'approve', 'reply', 'explicit']));
    expect(before.blocked).toBeGreaterThan(0);
  });

  it('leaves only the population that needs staff to re-accept', async () => {
    const db = fixtures();

    await migrateJobContractFlow(db as any);
    const after = await verifyJobContractFlow(db as any);

    expect(after.acceptedJobsMissingExactAcceptance.sort()).toEqual(['nobilling', 'noversions']);
    expect(after.changesRequestedJobsWithNoAction).toEqual([]);
    expect(after.lifecycleSowVersionsMissingSource).toEqual(['orphan-sow:7']);
  });
});
