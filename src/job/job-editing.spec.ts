import { customerMayEdit, jobIsWithCustomer, editingClosedByTransition } from './job-editing';
import { JobState } from './job.model';

describe('customerMayEdit', () => {
  it('is the flag, not the state', () => {
    expect(customerMayEdit({ customerEditingEnabled: true } as any)).toBe(true);
    expect(customerMayEdit({ customerEditingEnabled: false } as any)).toBe(false);
  });

  it('locks a job whose flag was never written', () => {
    expect(customerMayEdit({} as any)).toBe(false);
    expect(customerMayEdit({ customerEditingEnabled: undefined } as any)).toBe(false);
    expect(customerMayEdit({ customerEditingEnabled: null } as any)).toBe(false);
  });

  it('does not consult the state, so an approval request stays read only', () => {
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
