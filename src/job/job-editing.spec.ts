import { customerMayEdit, jobIsWithCustomer, editingClosedByTransition, legacyCustomerAction } from './job-editing';
import { CustomerActionRequired, JobState } from './job.model';

describe('customerMayEdit', () => {
  it('requires both CHANGES_REQUESTED and an explicit true grant', () => {
    expect(customerMayEdit({ state: JobState.CHANGES_REQUESTED, customerEditingEnabled: true } as any)).toBe(true);
    expect(customerMayEdit({ state: JobState.CHANGES_REQUESTED, customerEditingEnabled: false } as any)).toBe(false);
  });

  it('locks a job whose flag was never written', () => {
    expect(customerMayEdit({ state: JobState.CHANGES_REQUESTED } as any)).toBe(false);
    expect(customerMayEdit({ state: JobState.CHANGES_REQUESTED, customerEditingEnabled: undefined } as any)).toBe(false);
    expect(customerMayEdit({ state: JobState.CHANGES_REQUESTED, customerEditingEnabled: null } as any)).toBe(false);
  });

  it('locks stale true grants outside CHANGES_REQUESTED', () => {
    expect(customerMayEdit({ state: JobState.SUBMITTED, customerEditingEnabled: true } as any)).toBe(false);
    expect(customerMayEdit({ state: JobState.ACCEPTED, customerEditingEnabled: true } as any)).toBe(false);
  });

  it('keeps a CHANGES_REQUESTED approval request read only', () => {
    expect(customerMayEdit({ state: JobState.CHANGES_REQUESTED, customerEditingEnabled: false } as any)).toBe(false);
  });
});

describe('jobIsWithCustomer', () => {
  it('is true only while changes have been requested', () => {
    expect(jobIsWithCustomer({ state: JobState.CHANGES_REQUESTED } as any)).toBe(true);
    for (const state of [JobState.SUBMITTED, JobState.ACCEPTED, JobState.QUEUED, JobState.CLOSED]) {
      expect(jobIsWithCustomer({ state } as any)).toBe(false);
    }
  });
});

describe('editingClosedByTransition', () => {
  it('leaves the decision alone when the job is being handed to the customer', () => {
    expect(editingClosedByTransition(JobState.CHANGES_REQUESTED)).toBe(false);
  });

  it('closes editing when the customer hands the job back', () => {
    expect(editingClosedByTransition(JobState.SUBMITTED)).toBe(true);
  });

  it('closes editing on every state that means the lab holds the job', () => {
    for (const state of [JobState.ACCEPTED, JobState.QUEUED, JobState.IN_PROGRESS, JobState.COMPLETE, JobState.REJECTED, JobState.CLOSED, JobState.WAITING_FOR_SOW]) {
      expect(editingClosedByTransition(state)).toBe(true);
    }
  });
});

describe('legacyCustomerAction', () => {
  it('clears the action whenever legacy changeJobState leaves CHANGES_REQUESTED', () => {
    expect(legacyCustomerAction(JobState.SUBMITTED, true, 'anything')).toBeNull();
    expect(legacyCustomerAction(JobState.ACCEPTED, false, undefined)).toBeNull();
  });

  it('infers EDIT_WORKFLOW when the legacy editing grant is enabled', () => {
    expect(legacyCustomerAction(JobState.CHANGES_REQUESTED, true, 'Please revise')).toBe(CustomerActionRequired.EDIT_WORKFLOW);
  });

  it('infers APPROVE_WORKFLOW from the legacy approval note', () => {
    expect(legacyCustomerAction(JobState.CHANGES_REQUESTED, false, 'Approval requested')).toBe(CustomerActionRequired.APPROVE_WORKFLOW);
  });

  it('defaults legacy changes requests to REPLY', () => {
    expect(legacyCustomerAction(JobState.CHANGES_REQUESTED, false, 'Please clarify')).toBe(CustomerActionRequired.REPLY);
    expect(legacyCustomerAction(JobState.CHANGES_REQUESTED, false, undefined)).toBe(CustomerActionRequired.REPLY);
  });
});
