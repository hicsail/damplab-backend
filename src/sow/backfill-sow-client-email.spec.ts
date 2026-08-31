import { backfillSowClientEmail } from './backfill-sow-client-email';

class FakeCollection {
  constructor(readonly documents: any[]) {}

  find(query: any = {}): { toArray: () => Promise<any[]> } {
    const keys = Object.keys(query);
    const matches = this.documents.filter((document) => keys.every((key) => String(document[key]) === String(query[key])));
    return { toArray: async () => matches.map((document) => ({ ...document })) };
  }

  async updateOne(filter: any, update: any): Promise<void> {
    const document = this.documents.find((candidate) => String(candidate._id) === String(filter._id));
    if (document) Object.assign(document, update.$set ?? {});
  }
}

class FakeDb {
  readonly collections: Record<string, FakeCollection>;

  constructor(fixtures: Record<string, any[]>) {
    this.collections = Object.fromEntries(Object.entries(fixtures).map(([name, documents]) => [name, new FakeCollection(documents)]));
  }

  collection(name: string): FakeCollection {
    return this.collections[name] ?? (this.collections[name] = new FakeCollection([]));
  }
}

const db = (fixtures: Record<string, any[]>): any => new FakeDb(fixtures);

/**
 * The job-side fix stopped *new* SOWs copying the technician's address into
 * clientEmail. This corrects the ones already written, and — because an issued
 * version has the parties block baked into its stored text — reports rather than
 * rewrites the SOWs where correcting the record is not the whole job.
 */
describe('backfillSowClientEmail', () => {
  const job = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ _id: id, email: 'tech@damplab.org', clientEmail: 'jane@bu.edu', ...extra });
  const sow = (id: string, jobId: string, clientEmail: string): Record<string, unknown> => ({ _id: id, jobId, clientEmail });

  it('replaces the submitter address with the client it was submitted for', async () => {
    const fixtures = { sows: [sow('sow1', 'job1', 'tech@damplab.org')], jobs: [job('job1')], sow_versions: [] };
    const database = db(fixtures);

    const report = await backfillSowClientEmail(database, { log: () => undefined });

    expect(fixtures.sows[0].clientEmail).toBe('jane@bu.edu');
    expect(report.corrected).toBe(1);
  });

  it('leaves an ordinary customer-submitted SOW alone', async () => {
    // No clientEmail on the job means nobody submitted it on someone's behalf,
    // so its `email` is genuinely the client's.
    const fixtures = { sows: [sow('sow1', 'job1', 'jane@bu.edu')], jobs: [job('job1', { clientEmail: undefined, email: 'jane@bu.edu' })], sow_versions: [] };
    const database = db(fixtures);

    const report = await backfillSowClientEmail(database, { log: () => undefined });

    expect(fixtures.sows[0].clientEmail).toBe('jane@bu.edu');
    expect(report.corrected).toBe(0);
  });

  it('does not overwrite an address staff already corrected by hand', async () => {
    const fixtures = { sows: [sow('sow1', 'job1', 'someone.else@bu.edu')], jobs: [job('job1')], sow_versions: [] };
    const database = db(fixtures);

    const report = await backfillSowClientEmail(database, { log: () => undefined });

    expect(fixtures.sows[0].clientEmail).toBe('someone.else@bu.edu');
    expect(report.skipped).toBe(1);
  });

  it('is idempotent', async () => {
    const fixtures = { sows: [sow('sow1', 'job1', 'tech@damplab.org')], jobs: [job('job1')], sow_versions: [] };
    const database = db(fixtures);

    await backfillSowClientEmail(database, { log: () => undefined });
    const second = await backfillSowClientEmail(database, { log: () => undefined });

    expect(second.corrected).toBe(0);
    expect(fixtures.sows[0].clientEmail).toBe('jane@bu.edu');
  });

  it('writes nothing on a dry run but still reports what it would do', async () => {
    const fixtures = { sows: [sow('sow1', 'job1', 'tech@damplab.org')], jobs: [job('job1')], sow_versions: [] };
    const database = db(fixtures);

    const report = await backfillSowClientEmail(database, { dryRun: true, log: () => undefined });

    expect(fixtures.sows[0].clientEmail).toBe('tech@damplab.org');
    expect(report.corrected).toBe(1);
  });

  it('flags a SOW already issued to the customer, whose stored text it cannot fix', async () => {
    // The document record is corrected either way; what the report adds is that
    // this one's parties block was rendered before the fix and is frozen in an
    // issued version, so somebody has to decide whether to reissue it.
    const fixtures = {
      sows: [sow('sow1', 'job1', 'tech@damplab.org')],
      jobs: [job('job1')],
      sow_versions: [{ _id: 'v1', sowId: 'sow1', versionNumber: 1000, visibleToCustomer: true }]
    };
    const database = db(fixtures);

    const report = await backfillSowClientEmail(database, { log: () => undefined });

    expect(fixtures.sows[0].clientEmail).toBe('jane@bu.edu');
    expect(report.needsReissue).toEqual([{ sowId: 'sow1', issuedVersions: [1000] }]);
  });

  it('does not flag a SOW whose only versions are unsent drafts', async () => {
    const fixtures = {
      sows: [sow('sow1', 'job1', 'tech@damplab.org')],
      jobs: [job('job1')],
      sow_versions: [{ _id: 'v1', sowId: 'sow1', versionNumber: 1, visibleToCustomer: false }]
    };
    const database = db(fixtures);

    const report = await backfillSowClientEmail(database, { log: () => undefined });

    expect(report.needsReissue).toEqual([]);
  });

  it('records a SOW whose job has gone missing instead of throwing', async () => {
    const fixtures = { sows: [sow('sow1', 'job-gone', 'tech@damplab.org')], jobs: [], sow_versions: [] };
    const database = db(fixtures);

    const report = await backfillSowClientEmail(database, { log: () => undefined });

    expect(report.corrected).toBe(0);
    expect(report.orphaned).toEqual(['sow1']);
  });
});
