import { CommentAuthorType, CommentSchema } from './comment.model';
import { CommentService } from './comment.service';

const JOB_ID = '000000000000000000000001';

describe('Comment operation index', () => {
  it('indexes only rows whose operationId is a string', () => {
    const operationIndex = CommentSchema.indexes().find(([keys]) => keys.jobId === 1 && keys.operationId === 1);

    expect(operationIndex?.[0]).toEqual({ jobId: 1, operationId: 1 });
    expect(operationIndex?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { operationId: { $type: 'string' } }
    });
    expect(operationIndex?.[1]).not.toHaveProperty('sparse');
  });
});

function buildHarness(): { service: CommentService; comments: any[]; raceCreateOnce: () => void } {
  const comments: any[] = [];
  let createRaces = 0;
  const exec = <T>(value: T): { exec: () => Promise<T> } => ({ exec: async () => value });
  const commentModel: any = {
    findOne: (query: any) => exec(comments.find((comment) => comment.jobId === query.jobId && comment.operationId === query.operationId) ?? null),
    create: async (input: any) => {
      const created = { _id: `comment-${comments.length + 1}`, ...input };
      comments.push(created);
      if (createRaces > 0) {
        createRaces -= 1;
        const error: any = new Error('duplicate comment');
        error.code = 11000;
        throw error;
      }
      return created;
    }
  };
  const jobService: any = {
    findById: async (jobId: string) => (jobId === JOB_ID ? { _id: JOB_ID } : null)
  };
  return {
    service: new CommentService(commentModel, jobService),
    comments,
    raceCreateOnce: (): void => {
      createRaces += 1;
    }
  };
}

describe('CommentService.createIdempotent', () => {
  it('returns the existing job-scoped comment when an operationId is retried', async () => {
    const { service, comments } = buildHarness();
    const input = {
      operationId: 'review-1',
      jobId: JOB_ID,
      content: 'Review decision: Changes requested\n\nPlease revise.',
      author: 'Staff Person',
      authorType: CommentAuthorType.STAFF,
      isInternal: false
    };

    const first = await service.createIdempotent(input);
    const second = await service.createIdempotent(input);

    expect(second).toBe(first);
    expect(comments).toHaveLength(1);
    expect(comments[0].operationId).toBe('review-1');
  });

  it('does not deduplicate the same operationId across different jobs', async () => {
    const { service, comments } = buildHarness();
    const secondJobId = '000000000000000000000002';
    (service as any).jobService.findById = async (): Promise<{ _id: string }> => ({ _id: secondJobId });

    await service.createIdempotent({
      operationId: 'shared-operation',
      jobId: JOB_ID,
      content: 'First job',
      author: 'Staff Person',
      authorType: CommentAuthorType.STAFF,
      isInternal: false
    });
    await service.createIdempotent({
      operationId: 'shared-operation',
      jobId: secondJobId,
      content: 'Second job',
      author: 'Staff Person',
      authorType: CommentAuthorType.STAFF,
      isInternal: false
    });

    expect(comments).toHaveLength(2);
  });

  it('returns the concurrent winner when create loses a duplicate-key race', async () => {
    const { service, comments, raceCreateOnce } = buildHarness();
    raceCreateOnce();

    const result = await service.createIdempotent({
      operationId: 'comment-race',
      jobId: JOB_ID,
      content: 'Review decision',
      author: 'Staff Person',
      authorType: CommentAuthorType.STAFF,
      isInternal: false
    });

    expect(result).toBe(comments[0]);
    expect(comments).toHaveLength(1);
  });
});
