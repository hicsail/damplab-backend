import { resetDb, seedService, startTestApp, stopTestApp, TestApp, workflowInput } from './harness';
import * as F from './sow-flow';

/**
 * What a customer can do besides say yes.
 *
 * Rejecting, declining and cancelling all hand something back, and each has to
 * land in the one channel the customer and the lab share — the job's comment
 * thread. These need a database because every one of them is a compare-and-set
 * against the job or the SOW's version pointers, and the in-memory stand-ins the
 * unit specs use always match.
 */

jest.setTimeout(60000);

describe('customer-initiated commands', () => {
  let ctx: TestApp;
  let serviceId: string;

  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp(ctx);
  });
  beforeEach(async () => {
    await resetDb(ctx);
    serviceId = await seedService(ctx);
  });

  async function accepted(): Promise<string> {
    const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
    await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', `op-accept-${job.id}`);
    return job.id;
  }

  async function issued(): Promise<{ jobId: string; sowId: string; activeVersionNumber: number }> {
    const jobId = await accepted();
    const sow = await F.createSowForJob(ctx, 'staff', jobId);
    const fresh = await F.readSow(ctx, 'staff', sow.id);
    await F.saveSowVersion(ctx, 'staff', sow.id, fresh.currentVersion, { note: 'Filled in' });
    const sent = await F.sendSowToCustomer(ctx, 'staff', sow.id);
    return { jobId, sowId: sow.id, activeVersionNumber: sent.versionNumber };
  }

  describe('rejecting a workflow the lab asked them to approve', () => {
    it('returns the job to the lab and explains why, in the customer’s own voice', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      await F.reviewJob(ctx, 'staff', job.id, 'REQUEST_APPROVAL', 'op-approve', 'Please confirm these changes.');

      const rejected = await F.rejectJobReview(ctx, 'customer', job.id, 'op-reject', 'The volumes are wrong.');
      expect({ state: rejected.state, action: rejected.customerActionRequired }).toEqual({ state: 'SUBMITTED', action: null });

      const comments = await F.jobComments(ctx, 'customer', job.id);
      expect(comments).toContainEqual(expect.objectContaining({ authorType: 'CLIENT', content: 'Customer rejected the proposed workflow\n\nThe volumes are wrong.' }));
    });

    it('leaves the job editable by staff again, which is the point of handing it back', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      await F.reviewJob(ctx, 'staff', job.id, 'REQUEST_APPROVAL', 'op-approve', 'Please confirm.');
      await F.rejectJobReview(ctx, 'customer', job.id, 'op-reject', 'No.');

      await F.saveJobWorkflows(ctx, 'staff', job.id, [F.editorWorkflow(serviceId, ['n1'])], 'Reworked after the rejection');
      expect((await F.jobState(ctx, 'staff', job.id)).state).toBe('SUBMITTED');
    });

    it('drops the lab’s edits, putting the graph back to what the customer put forward', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      expect(await F.jobWorkflowNodeIds(ctx, 'customer', job.id)).toEqual(['node-1']);

      // The lab reworks the graph, then asks the customer to approve it.
      await F.saveJobWorkflows(ctx, 'staff', job.id, [F.editorWorkflow(serviceId, ['lab-a', 'lab-b'])], 'Reworked the design');
      expect(await F.jobWorkflowNodeIds(ctx, 'staff', job.id)).toEqual(['lab-a', 'lab-b']);
      await F.reviewJob(ctx, 'staff', job.id, 'REQUEST_APPROVAL', 'op-approve', 'Please confirm these changes.');

      await F.rejectJobReview(ctx, 'customer', job.id, 'op-reject', 'That is not what I asked for.');

      // Back to the customer's own submission, not the lab's rework.
      expect(await F.jobWorkflowNodeIds(ctx, 'staff', job.id)).toEqual(['node-1']);
    });

    it('records the revert as a new customer version rather than rewriting history', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      await F.saveJobWorkflows(ctx, 'staff', job.id, [F.editorWorkflow(serviceId, ['lab-a'])], 'Reworked the design');
      await F.reviewJob(ctx, 'staff', job.id, 'REQUEST_APPROVAL', 'op-approve', 'Please confirm.');

      await F.rejectJobReview(ctx, 'customer', job.id, 'op-reject', 'No.');

      const customerView = await F.jobContentVersions(ctx, 'customer', job.id);
      const newest = customerView[customerView.length - 1];
      expect({ author: newest.authorRole, note: newest.note }).toEqual({ author: 'CUSTOMER', note: 'Rejected the lab’s changes' });

      // Read as staff, because an unpublished staff edit is not in the
      // customer's history: the lab's version is still there, undone rather
      // than erased, and Revert can still reach it.
      const fullHistory = await F.jobContentVersions(ctx, 'staff', job.id);
      expect(fullHistory.some((v: any) => v.workflows[0].nodes.some((n: any) => n.id === 'lab-a'))).toBe(true);
    });

    it('leaves the graph alone when the lab asked for approval without editing anything', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      await F.reviewJob(ctx, 'staff', job.id, 'REQUEST_APPROVAL', 'op-approve', 'Happy with this?');
      const before = await F.jobContentVersions(ctx, 'customer', job.id);

      await F.rejectJobReview(ctx, 'customer', job.id, 'op-reject', 'Changed my mind.');

      // No new content version: there was nothing of the lab's to undo.
      expect((await F.jobContentVersions(ctx, 'customer', job.id)).length).toBe(before.length);
      expect(await F.jobWorkflowNodeIds(ctx, 'customer', job.id)).toEqual(['node-1']);
    });

    it('refuses a job that is not awaiting approval, and refuses a stranger', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      expect(await F.rejectJobReviewError(ctx, 'customer', job.id, 'op-a', 'No.')).toMatch(/not awaiting your approval/);

      await F.reviewJob(ctx, 'staff', job.id, 'REQUEST_APPROVAL', 'op-approve', 'Please confirm.');
      expect(await F.rejectJobReviewError(ctx, 'otherCustomer', job.id, 'op-b', 'No.')).toMatch(/permission/);
    });
  });

  describe('declining to sign a Statement of Work', () => {
    it('takes the document out of force and lets staff revise and reissue it', async () => {
      const { sowId, activeVersionNumber } = await issued();

      await F.declineSow(ctx, 'customer', sowId, 'The turnaround is too slow.');

      const afterDecline = await F.readSow(ctx, 'staff', sowId);
      expect(afterDecline.activeVersionNumber).toBe(0);
      // The version they were sent stays in history, immutable.
      expect((await F.sowVersions(ctx, 'staff', sowId)).find((v) => v.versionNumber === activeVersionNumber)?.status).toBe('SENT');

      await F.saveSowVersion(ctx, 'staff', sowId, afterDecline.currentVersion, { note: 'Faster turnaround' });
      const reissued = await F.sendSowToCustomer(ctx, 'staff', sowId);
      expect(reissued.status).toBe('SENT');
    });

    it('stops the customer signing the version they declined', async () => {
      const { sowId, activeVersionNumber } = await issued();
      const before = await F.readSow(ctx, 'customer', sowId, activeVersionNumber);

      await F.declineSow(ctx, 'customer', sowId, 'Not going ahead with this version.');

      expect(await F.signSowError(ctx, 'customer', sowId, F.signatureFor(before.currentVersion, 'Jane Rivera'))).toBeTruthy();
    });

    it('tells the lab why, attributed to the client', async () => {
      const { jobId, sowId } = await issued();
      await F.declineSow(ctx, 'customer', sowId, 'The turnaround is too slow.');

      const comments = await F.jobComments(ctx, 'staff', jobId);
      expect(comments).toContainEqual(
        expect.objectContaining({
          authorType: 'CLIENT',
          content: expect.stringContaining('The client declined to sign this Statement of Work.')
        })
      );
      expect(comments.some((c) => c.content.includes('The turnaround is too slow.'))).toBe(true);
    });

    it('is refused for staff and for someone else’s job', async () => {
      const { sowId } = await issued();
      // Staff have withdrawSowFromCustomer; they cannot refuse on the client's behalf.
      expect(await F.declineSowError(ctx, 'staff', sowId, 'nope')).toMatch(/owns this job can decline/);
      expect(await F.declineSowError(ctx, 'otherCustomer', sowId, 'nope')).toBeTruthy();
    });
  });

  describe('cancelling the job outright', () => {
    it('cancels the job and the Statement of Work standing against it', async () => {
      const { jobId, sowId } = await issued();

      const cancelled = await F.cancelJob(ctx, 'customer', jobId, 'op-cancel', 'Grant fell through.');
      expect(cancelled.state).toBe('CANCELLED');
      expect((await F.readSow(ctx, 'staff', sowId)).status).toBe('CANCELLED');
    });

    it('leaves nothing signable behind', async () => {
      const { jobId, sowId, activeVersionNumber } = await issued();
      const before = await F.readSow(ctx, 'customer', sowId, activeVersionNumber);

      await F.cancelJob(ctx, 'customer', jobId, 'op-cancel', 'Grant fell through.');

      expect(await F.signSowError(ctx, 'customer', sowId, F.signatureFor(before.currentVersion, 'Jane Rivera'))).toBeTruthy();
    });

    it('is still allowed after the client has signed, but not after the lab countersigns', async () => {
      const { jobId, sowId, activeVersionNumber } = await issued();
      const snapshot = await F.readSow(ctx, 'customer', sowId, activeVersionNumber);
      await F.signSow(ctx, 'customer', sowId, F.signatureFor(snapshot.currentVersion, 'Jane Rivera'));

      // One signature is not an agreement between both parties.
      const stillCancellable = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      expect(stillCancellable).toBeTruthy();

      await F.finalizeSow(ctx, 'staff', sowId, 'Courtney Tretheway');
      expect(await F.cancelJobError(ctx, 'customer', jobId, 'op-cancel', 'Too late.')).toMatch(/signed by both parties/);
    });

    it('cancels a job that never got a Statement of Work at all', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      expect((await F.cancelJob(ctx, 'customer', job.id, 'op-cancel', 'Changed my mind.')).state).toBe('CANCELLED');
    });

    it('refuses a stranger', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      expect(await F.cancelJobError(ctx, 'otherCustomer', job.id, 'op-cancel', 'Not mine.')).toMatch(/permission/);
    });
  });

  describe('requesting edit access', () => {
    it('records the ask without opening the editor — staff still decide', async () => {
      const jobId = await accepted();

      const requested = await F.requestJobEditAccess(ctx, 'customer', jobId, 'op-req', 'I need to add a sample.');
      expect({ state: requested.state, pending: requested.editAccessRequestedAt != null }).toEqual({ state: 'ACCEPTED', pending: true });

      // The job is accepted, so the customer still cannot save over it.
      expect(await F.saveJobWorkflowsError(ctx, 'customer', jobId, [F.editorWorkflow(serviceId, ['n1'])], 'sneaking in')).toBeTruthy();
    });

    it('reaches the lab as a comment', async () => {
      const jobId = await accepted();
      await F.requestJobEditAccess(ctx, 'customer', jobId, 'op-req', 'I need to add a sample.');

      expect(await F.jobComments(ctx, 'staff', jobId)).toContainEqual(
        expect.objectContaining({ authorType: 'CLIENT', content: 'Customer requested access to edit this job\n\nI need to add a sample.' })
      );
    });

    it('is granted the ordinary way, and the request is retired by that decision', async () => {
      const jobId = await accepted();
      await F.requestJobEditAccess(ctx, 'customer', jobId, 'op-req');

      await F.reviewJob(ctx, 'staff', jobId, 'REQUEST_EDITS', 'op-grant', 'Go ahead — add the sample.');
      const after = await F.jobState(ctx, 'staff', jobId);
      expect({ state: after.state, action: after.customerActionRequired }).toEqual({ state: 'CHANGES_REQUESTED', action: 'EDIT_WORKFLOW' });

      // And now the editor really is open to them.
      await F.saveJobWorkflows(ctx, 'customer', jobId, [F.editorWorkflow(serviceId, ['n1'])], 'Added the sample');
    });

    it('is refused once the customer has signed', async () => {
      const { jobId, sowId, activeVersionNumber } = await issued();
      const snapshot = await F.readSow(ctx, 'customer', sowId, activeVersionNumber);
      await F.signSow(ctx, 'customer', sowId, F.signatureFor(snapshot.currentVersion, 'Jane Rivera'));

      expect(await F.requestJobEditAccessError(ctx, 'customer', jobId, 'op-req')).toMatch(/signed/);
    });

    it('is refused when they already hold edit access', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      await F.reviewJob(ctx, 'staff', job.id, 'REQUEST_EDITS', 'op-edits', 'Please revise.');

      expect(await F.requestJobEditAccessError(ctx, 'customer', job.id, 'op-req')).toMatch(/already have edit access/);
    });
  });
});
