import { JobReviewOperationSchema } from './job-review-operation.model';

describe('JobReviewOperation schema', () => {
  it('uniquely journals each caller operationId', () => {
    const operationIndex = JobReviewOperationSchema.indexes().find(([keys]) => keys.operationId === 1);

    expect(operationIndex?.[0]).toEqual({ operationId: 1 });
    expect(operationIndex?.[1]).toMatchObject({ unique: true });
  });

  it('requires the identity, payload, original state, and progress needed to resume safely', () => {
    for (const path of ['operationId', 'jobId', 'commandKind', 'payloadHash', 'actorSub', 'actorName', 'originalState', 'status']) {
      expect(JobReviewOperationSchema.path(path)?.isRequired).toBe(true);
    }

    for (const path of [
      'decision',
      'responseAction',
      'normalizedMessage',
      'originalCustomerActionRequired',
      'originalAcceptedJobVersionNumber',
      'originalAcceptedBillingFingerprint',
      'originalAcceptedAt',
      'originalAcceptedBy',
      'originalReviewOperationId',
      'selectedAcceptedVersionNumber',
      'jobWrittenAt',
      'historyWrittenAt',
      'publishedAt',
      'commentWrittenAt',
      'completedAt',
      'compensatedAt',
      'restoreVersionNumber',
      'restoreWrittenAt',
      'originalHandoverVersionNumber',
      'selectedHandoverVersionNumber'
    ]) {
      expect(JobReviewOperationSchema.path(path)).toBeDefined();
    }
  });
});
