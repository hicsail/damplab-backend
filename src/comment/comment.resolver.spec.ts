import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommentResolver } from './comment.resolver';
import { Role } from '../auth/roles/roles.enum';

const job = { _id: 'job-1', sub: 'owner-sub', email: 'owner@x.org', memberEmails: ['member@x.org'] };
const comment = { _id: 'c1', jobId: 'job-1', content: 'hi', author: 'Member@X.org', authorType: 'CLIENT', isInternal: false };

const user = (sub: string, email: string, roles: string[] = []): any => ({ sub, email, preferred_username: sub, realm_access: { roles } });
const member = user('member-sub', 'member@x.org');
const owner = user('owner-sub', 'owner@x.org');
const stranger = user('x', 'x@x.org');
const tech = user('tech', 'tech@bu.edu', [Role.Technician]);
const admin = user('admin', 'admin@bu.edu', [Role.DamplabStaff]);

function harness(): { resolver: CommentResolver; commentService: any } {
  const commentService: any = {
    findById: jest.fn(async (id: string) => (id === 'c1' ? comment : null)),
    findByJobWithVisibility: jest.fn(async () => [comment]),
    findByNode: jest.fn(async () => [comment, { ...comment, _id: 'c4', isInternal: true }]),
    create: jest.fn(async (input: any) => ({ _id: 'c2', ...input })),
    update: jest.fn(async () => comment),
    delete: jest.fn(async () => true)
  };
  const jobService: any = { findById: jest.fn(async (id: string) => (id === 'job-1' ? job : null)) };
  // Node n-1 is in a workflow that belongs to job-1; n-b is in job-2's workflow.
  const workflows: Record<string, any> = { 'n-1': { _id: 'wf-1' }, 'n-b': { _id: 'wf-b' } };
  const workflowService: any = { findWhereNodeId: jest.fn(async (id: string) => workflows[id] ?? null) };
  jobService.findByWorkflow = jest.fn(async (wf: any) => (wf._id === 'wf-1' ? job : { _id: 'job-2' }));
  const resolver = new CommentResolver(commentService, { createEvent: jest.fn(async () => undefined) } as any, { dispatch: jest.fn() } as any, {} as any, jobService, workflowService);
  return { resolver, commentService };
}

describe('CommentResolver — scoped to the job (F1)', () => {
  it('lists comments for a member and a jobs:view-all holder', async () => {
    const { resolver } = harness();
    await expect(resolver.commentsByJobId('job-1', member)).resolves.toHaveLength(1);
    await expect(resolver.commentsByJobId('job-1', tech)).resolves.toHaveLength(1);
  });

  it('refuses a stranger listing, creating, or reading by id', async () => {
    const { resolver, commentService } = harness();
    await expect(resolver.commentsByJobId('job-1', stranger)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(resolver.createComment({ jobId: 'job-1', content: 'x', author: 'x', authorType: 'CLIENT' } as any, stranger)).rejects.toBeInstanceOf(ForbiddenException);
    expect(commentService.create).not.toHaveBeenCalled();
    await expect(resolver.commentById('c1', stranger)).resolves.toBeNull();
  });

  it('404s on a job that does not exist', async () => {
    const { resolver } = harness();
    await expect(resolver.commentsByJobId('nope', member)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a member post and read a comment by id', async () => {
    const { resolver } = harness();
    await expect(resolver.createComment({ jobId: 'job-1', content: 'x', author: '', authorType: 'CLIENT' } as any, member)).resolves.toMatchObject({ _id: 'c2' });
    await expect(resolver.commentById('c1', member)).resolves.toMatchObject({ _id: 'c1' });
  });
});

describe('CommentResolver — who a comment is from comes from the token (B30)', () => {
  // The reported bug: on a staff-submitted job the client page passed job.email
  // (the technician's) as the commenter, so the client's comment read as staff's.
  const staffSubmitted = { _id: 'job-1', sub: 'client-kc', email: 'client@bu.edu', clientEmail: 'client@bu.edu', submittedBy: { sub: 'admin-1', email: 'tech@bu.edu' } };

  it("stores the client's own email and CLIENT, whatever author the page sent", async () => {
    const { resolver, commentService } = harness();
    (resolver as any).jobService.findById = async (): Promise<any> => staffSubmitted;
    await resolver.createComment({ jobId: 'job-1', content: 'hello', author: 'tech@bu.edu', authorType: 'STAFF' } as any, user('client-kc', 'Client@BU.edu'));
    expect(commentService.create.mock.calls[0][0]).toMatchObject({ author: 'Client@BU.edu', authorType: 'CLIENT' });
  });

  it('stamps staff-flavoured callers STAFF', async () => {
    const { resolver, commentService } = harness();
    await resolver.createComment({ jobId: 'job-1', content: 'x', author: 'someone', authorType: 'CLIENT' } as any, tech);
    expect(commentService.create.mock.calls[0][0]).toMatchObject({ author: 'tech@bu.edu', authorType: 'STAFF' });
  });
});

describe('CommentResolver — only the author or staff change a comment (B6)', () => {
  it('lets the author update and delete, matching case-insensitively', async () => {
    const { resolver, commentService } = harness();
    await resolver.updateComment('c1', { content: 'edited' }, member);
    await resolver.deleteComment('c1', member);
    expect(commentService.update).toHaveBeenCalled();
    expect(commentService.delete).toHaveBeenCalled();
  });

  it('refuses another member who is not the author', async () => {
    const { resolver, commentService } = harness();
    await expect(resolver.updateComment('c1', { content: 'x' }, owner)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(resolver.deleteComment('c1', owner)).rejects.toBeInstanceOf(ForbiddenException);
    expect(commentService.update).not.toHaveBeenCalled();
  });

  it('lets damplab-staff change any comment, but not a technician who is not the author', async () => {
    const { resolver } = harness();
    await expect(resolver.updateComment('c1', { content: 'x' }, admin)).resolves.toBeDefined();
    await expect(resolver.deleteComment('c1', tech)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps deleting a missing comment a false, not an error', async () => {
    const { resolver } = harness();
    await expect(resolver.deleteComment('missing', admin)).resolves.toBe(false);
  });
});

describe('CommentResolver — internal notes stay staff-only', () => {
  const internal = { ...comment, _id: 'c3', isInternal: true };

  it('commentById hides an internal comment from a client member and shows it to staff', async () => {
    const { resolver, commentService } = harness();
    commentService.findById = jest.fn(async () => internal);
    await expect(resolver.commentById('c3', member)).resolves.toBeNull();
    await expect(resolver.commentById('c3', admin)).resolves.toMatchObject({ _id: 'c3' });
  });

  it('createComment stores isInternal false for a non-staff caller, keeps it for staff', async () => {
    const { resolver, commentService } = harness();
    await resolver.createComment({ jobId: 'job-1', content: 'x', isInternal: true } as any, member);
    expect(commentService.create.mock.calls[0][0]).toMatchObject({ isInternal: false });
    await resolver.createComment({ jobId: 'job-1', content: 'x', isInternal: true } as any, admin);
    expect(commentService.create.mock.calls[1][0]).toMatchObject({ isInternal: true });
  });

  it('updateComment ignores an isInternal change from a non-staff author', async () => {
    const { resolver, commentService } = harness();
    await resolver.updateComment('c1', { content: 'e', isInternal: true }, member);
    expect(commentService.update.mock.calls[0][1].isInternal).toBeUndefined();
  });

  it('update and delete refuse a stranger at the membership check, before the author check', async () => {
    const { resolver, commentService } = harness();
    const asStranger = user('x', 'Member@X.org'); // matches the stored author, still not on the job
    (resolver as any).jobService.findById = async (): Promise<any> => ({ ...job, memberEmails: [], email: 'owner@x.org' });
    await expect(resolver.updateComment('c1', { content: 'x' }, asStranger)).rejects.toThrow('permission to see the comments');
    await expect(resolver.deleteComment('c1', asStranger)).rejects.toThrow('permission to see the comments');
    expect(commentService.update).not.toHaveBeenCalled();
    expect(commentService.delete).not.toHaveBeenCalled();
  });
});

describe('CommentResolver — a technician writes and reads internal notes', () => {
  const internal = { ...comment, _id: 'c3', isInternal: true };

  it("stores a technician's internal note as internal", async () => {
    const { resolver, commentService } = harness();
    await resolver.createComment({ jobId: 'job-1', content: 'bench', isInternal: true } as any, tech);
    expect(commentService.create.mock.calls[0][0]).toMatchObject({ isInternal: true, authorType: 'STAFF' });
  });

  it('lets a technician read internal notes by job and by id, and a client member not', async () => {
    const { resolver, commentService } = harness();
    await resolver.commentsByJobId('job-1', tech);
    expect(commentService.findByJobWithVisibility).toHaveBeenLastCalledWith('job-1', true);
    await resolver.commentsByJobId('job-1', member);
    expect(commentService.findByJobWithVisibility).toHaveBeenLastCalledWith('job-1', false);
    commentService.findById = jest.fn(async () => internal);
    await expect(resolver.commentById('c3', tech)).resolves.toMatchObject({ _id: 'c3' });
    await expect(resolver.commentById('c3', member)).resolves.toBeNull();
  });

  it('lets a technician change visibility on update; a client member cannot', async () => {
    const { resolver, commentService } = harness();
    commentService.findById = jest.fn(async () => ({ ...comment, author: 'tech@bu.edu' }));
    await resolver.updateComment('c1', { isInternal: true }, tech);
    expect(commentService.update.mock.calls[0][1].isInternal).toBe(true);
  });
});

describe('CommentResolver — commentsByNodeId is scoped to the job', () => {
  it('refuses a stranger', async () => {
    const { resolver } = harness();
    await expect(resolver.commentsByNodeId('n1', stranger)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('shows a technician the internal bench notes and a client member only the public ones', async () => {
    const { resolver } = harness();
    await expect(resolver.commentsByNodeId('n1', tech)).resolves.toHaveLength(2);
    const seen = await resolver.commentsByNodeId('n1', member);
    expect(seen.map((c: any) => c._id)).toEqual(['c1']);
  });
});

describe('CommentResolver — API keys never see internal notes', () => {
  const apiKeyUser: any = { sub: 'apikey:1', apiKey: true, readOnly: true, preferred_username: 'lab-monitor', realm_access: { roles: [] } };

  it('passes includeInternal=false to commentsByJobId', async () => {
    const { resolver, commentService } = harness();
    await resolver.commentsByJobId('job-1', apiKeyUser);
    expect(commentService.findByJobWithVisibility).toHaveBeenCalledWith('job-1', false);
  });

  it('returns null for an internal note by id', async () => {
    const { resolver, commentService } = harness();
    commentService.findById.mockResolvedValue({ ...comment, isInternal: true });
    await expect(resolver.commentById('c1', apiKeyUser)).resolves.toBeNull();
  });

  it('filters internal notes out of commentsByNodeId', async () => {
    const { resolver } = harness();
    const result = await resolver.commentsByNodeId('n1', apiKeyUser);
    expect(result.every((c) => !c.isInternal)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('cannot create an internal comment', async () => {
    const { resolver, commentService } = harness();
    await resolver.createComment({ jobId: 'job-1', content: 'x', isInternal: true } as any, apiKeyUser);
    expect(commentService.create.mock.calls[0][0]).toMatchObject({ isInternal: false });
  });
});

describe('CommentResolver — a node comment must be on a node of that job', () => {
  it("refuses another job's node, and a node that does not exist", async () => {
    const { resolver, commentService } = harness();
    await expect(resolver.createComment({ jobId: 'job-1', content: 'x', nodeId: 'n-b' } as any, member)).rejects.toBeInstanceOf(BadRequestException);
    await expect(resolver.createComment({ jobId: 'job-1', content: 'x', nodeId: 'missing' } as any, member)).rejects.toBeInstanceOf(BadRequestException);
    expect(commentService.create).not.toHaveBeenCalled();
  });

  it("accepts the job's own node, and a comment with no node", async () => {
    const { resolver } = harness();
    await expect(resolver.createComment({ jobId: 'job-1', content: 'x', nodeId: 'n-1' } as any, member)).resolves.toMatchObject({ _id: 'c2' });
    await expect(resolver.createComment({ jobId: 'job-1', content: 'x' } as any, member)).resolves.toMatchObject({ _id: 'c2' });
  });
});
