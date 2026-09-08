import { alreadyInvoiced, auditCountersignGate } from './audit-countersign-gate';

/** Just enough of a Db to serve `sows`, `sow_versions` and an invoice count. */
function db(opts: { sows: unknown[]; versions?: unknown[]; invoices?: unknown[] }): any {
  const versions = opts.versions ?? [];
  const invoices: any[] = (opts.invoices ?? []) as any[];
  return {
    collection: (name: string): any => {
      if (name === 'sows') return { find: () => ({ toArray: async (): Promise<unknown[]> => opts.sows }) };
      if (name === 'sow_versions') {
        return {
          find: (filter: any) => ({
            toArray: async (): Promise<unknown[]> => versions.filter((v: any) => v.sowId === filter.sowId && v.isStaged !== true && v.isDiscarded !== true)
          })
        };
      }
      return {
        countDocuments: async (filter: any): Promise<number> => invoices.filter((inv) => inv.jobId === filter.jobId && inv.voidedAt == null).length
      };
    }
  };
}

const sow = (over: any = {}): any => ({ _id: 'sow-1', jobId: 'job-1', sowNumber: 'SOW-001', status: 'DRAFT', activeVersionNumber: 0, ...over });
const version = (over: any = {}): any => ({ sowId: 'sow-1', versionNumber: 1000, status: 'DRAFT', visibleToCustomer: false, ...over });

describe('audit: which jobs a countersign gate would block', () => {
  it('passes a SOW whose countersigned version is in force', async () => {
    const report = await auditCountersignGate(
      db({
        sows: [sow({ status: 'FINAL', activeVersionNumber: 1001 })],
        versions: [version({ versionNumber: 1001, status: 'FINAL', visibleToCustomer: true })]
      })
    );

    expect(report.invoiceable).toBe(1);
    expect(alreadyInvoiced(report)).toEqual([]);
  });

  it('will not pass a FINAL row the parent pointer never claimed', async () => {
    // visibleToCustomer is set only after the CAS; an unclaimed row is not in force.
    const report = await auditCountersignGate(
      db({
        sows: [sow({ activeVersionNumber: 1001 })],
        versions: [version({ versionNumber: 1001, status: 'FINAL', visibleToCustomer: false })]
      })
    );

    expect(report.invoiceable).toBe(0);
    expect(report.countersignedThenWithdrawn).toHaveLength(1);
  });

  it('buckets a versioned SOW that has never been countersigned', async () => {
    const report = await auditCountersignGate(db({ sows: [sow({ status: 'SENT', activeVersionNumber: 1000 })], versions: [version({ status: 'SENT', visibleToCustomer: true })] }));

    expect(report.neverCountersigned).toHaveLength(1);
    expect(report.neverCountersigned[0]).toMatchObject({ jobId: 'job-1', activeVersionStatus: 'SENT', invoiceCount: 0 });
    expect(report.legacyUnversioned).toEqual([]);
  });

  it('buckets a countersigned SOW that was later withdrawn, which zeroes the pointer', async () => {
    const report = await auditCountersignGate(
      db({
        sows: [sow({ status: 'FINAL', activeVersionNumber: 0 })],
        versions: [version({ versionNumber: 1001, status: 'FINAL', visibleToCustomer: true })]
      })
    );

    // Staff will remember countersigning this one, so the refusal must say withdrawn.
    expect(report.countersignedThenWithdrawn).toHaveLength(1);
    expect(report.neverCountersigned).toEqual([]);
  });

  it('buckets a countersigned SOW that was later cancelled', async () => {
    const report = await auditCountersignGate(
      db({
        sows: [sow({ status: 'CANCELLED', activeVersionNumber: 1002 })],
        versions: [version({ versionNumber: 1001, status: 'FINAL', visibleToCustomer: true }), version({ versionNumber: 1002, status: 'CANCELLED', visibleToCustomer: true })]
      })
    );

    expect(report.countersignedThenWithdrawn).toHaveLength(1);
    expect(report.countersignedThenWithdrawn[0].activeVersionStatus).toBe('CANCELLED');
  });

  it('buckets a pre-versioning SOW separately, because it can never reach FINAL', async () => {
    const report = await auditCountersignGate(db({ sows: [sow()], versions: [] }));

    expect(report.legacyUnversioned).toHaveLength(1);
    expect(report.neverCountersigned).toEqual([]);
  });

  it('ignores staged and discarded rows, which the parent pointers never reach', async () => {
    const report = await auditCountersignGate(
      db({
        sows: [sow()],
        versions: [version({ versionNumber: 1001, status: 'FINAL', isStaged: true }), version({ versionNumber: 1002, status: 'FINAL', isDiscarded: true })]
      })
    );

    // A staged FINAL is a write in flight, not history — so this is legacy, not
    // "countersigned then withdrawn".
    expect(report.legacyUnversioned).toHaveLength(1);
    expect(report.countersignedThenWithdrawn).toEqual([]);
  });

  it('counts standing invoices only, so a voided one does not look like part-billing', async () => {
    const report = await auditCountersignGate(
      db({
        sows: [sow({ status: 'SENT', activeVersionNumber: 1000 })],
        versions: [version({ status: 'SENT', visibleToCustomer: true })],
        invoices: [
          { jobId: 'job-1', voidedAt: new Date() },
          { jobId: 'job-1', voidedAt: null }
        ]
      })
    );

    expect(report.neverCountersigned[0].invoiceCount).toBe(1);
    expect(alreadyInvoiced(report)).toHaveLength(1);
  });

  it('reports nothing to decide when every SOW is countersigned', async () => {
    const report = await auditCountersignGate(db({ sows: [], versions: [] }));

    expect(report).toMatchObject({ scannedSows: 0, invoiceable: 0, neverCountersigned: [], countersignedThenWithdrawn: [], legacyUnversioned: [] });
  });
});
