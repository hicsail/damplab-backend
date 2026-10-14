import { HomologyScreeningStatus } from './job.model';
import { customerBiosecurityView, redactJobBiosecurity, withoutBiosecurity } from './biosecurity-view';

const job = (): {
  _id: string;
  name: string;
  homologyScreening: { status: HomologyScreeningStatus; detail: string; batchId: string };
  screeningBatchIds: string[];
  aclidScreening: {
    screenId: string;
    homologyStatus: HomologyScreeningStatus;
    regulatoryStatus: string;
    verificationStatus: string;
    decisionStatus: string;
    verificationCompletedAt: Date;
    detail: string;
    customerStatus: HomologyScreeningStatus;
    sequenceCount: number;
    startedAt: Date;
  };
} => ({
  _id: 'job-1',
  name: 'Job',
  homologyScreening: { status: HomologyScreeningStatus.FAILED, detail: 'controlled toxin', batchId: 'batch-1' },
  screeningBatchIds: ['batch-1'],
  aclidScreening: {
    screenId: 'scr_1',
    homologyStatus: HomologyScreeningStatus.FAILED,
    regulatoryStatus: 'controlled',
    verificationStatus: 'submitted',
    decisionStatus: 'rejected',
    verificationCompletedAt: new Date('2026-09-02T00:00:00Z'),
    detail: 'Aclid screen succeeded',
    customerStatus: HomologyScreeningStatus.FAILED,
    sequenceCount: 4,
    startedAt: new Date('2026-09-01T00:00:00Z')
  }
});

describe('biosecurity view', () => {
  it('removes every screening field when the account cannot see the block', () => {
    const view = withoutBiosecurity(job());
    expect(view).toMatchObject({ _id: 'job-1', name: 'Job' });
    expect(view).not.toHaveProperty('homologyScreening');
    expect(view).not.toHaveProperty('aclidScreening');
    expect(view).not.toHaveProperty('screeningBatchIds');
  });

  it('tells the customer only that verification was submitted', () => {
    const view = customerBiosecurityView(job());
    expect(view.aclidScreening).toEqual({
      screenId: 'scr_1',
      verificationStatus: 'submitted',
      verificationCompletedAt: new Date('2026-09-02T00:00:00Z'),
      homologyStatus: HomologyScreeningStatus.UNAVAILABLE,
      customerStatus: HomologyScreeningStatus.UNAVAILABLE,
      sequenceCount: 0,
      startedAt: new Date('2026-09-01T00:00:00Z')
    });
    expect(view).not.toHaveProperty('homologyScreening');
    expect(view).not.toHaveProperty('screeningBatchIds');
  });

  it('redacts a mongoose document in memory and unmarks the edit', () => {
    const stored = job();
    const paths: string[] = [];
    const doc = {
      ...stored,
      set(path: string, value: unknown): void {
        (this as Record<string, unknown>)[path] = value;
      },
      unmarkModified(path: string): void {
        paths.push(path);
      }
    };
    const view = redactJobBiosecurity(doc, 'customer');
    expect(view).toBe(doc);
    expect(doc.aclidScreening.decisionStatus).toBeUndefined();
    expect(doc.aclidScreening.verificationStatus).toBe('submitted');
    expect(doc.homologyScreening).toBeNull();
    expect(paths).toEqual(['homologyScreening', 'aclidScreening', 'screeningBatchIds']);
    expect(stored.aclidScreening.decisionStatus).toBe('rejected');
  });

  it('does not mutate the stored job', () => {
    const stored = job();
    customerBiosecurityView(stored);
    expect(stored.aclidScreening.decisionStatus).toBe('rejected');
    expect(stored.homologyScreening.status).toBe(HomologyScreeningStatus.FAILED);
  });
});
