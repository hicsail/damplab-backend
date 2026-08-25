import { ForbiddenException } from '@nestjs/common';
import { assertJobContractWritable, awaitingCustomerApproval, customerMayEdit, jobIsWithCustomer, staffEditBlockedReason, staffMayEdit } from './job-editing';
import { CustomerActionRequired, JobState } from './job.model';

const job = (state: JobState, customerActionRequired: CustomerActionRequired | null = null): any => ({ state, customerActionRequired });

const STAFF = { isStaff: true, isOwner: false };
const OWNER = { isStaff: false, isOwner: true };
const STRANGER = { isStaff: false, isOwner: false };

describe('customerMayEdit', () => {
  it('is true only when the customer holds the job and was asked for edits', () => {
    expect(customerMayEdit(job(JobState.CHANGES_REQUESTED, CustomerActionRequired.EDIT_WORKFLOW))).toBe(true);
  });

  it('is false for the two read-only handoffs', () => {
    expect(customerMayEdit(job(JobState.CHANGES_REQUESTED, CustomerActionRequired.REPLY))).toBe(false);
    expect(customerMayEdit(job(JobState.CHANGES_REQUESTED, CustomerActionRequired.APPROVE_WORKFLOW))).toBe(false);
  });

  // A job with no recorded action is one the migration has not reached. Locking
  // is the safe reading: a customer who cannot edit asks the lab, whereas one
  // who should not have been able to edit rewrites a priced spec silently.
  it('is false when no action was recorded', () => {
    expect(customerMayEdit(job(JobState.CHANGES_REQUESTED, null))).toBe(false);
  });

  it('is false wherever the customer does not hold the job, whatever the action says', () => {
    for (const state of [JobState.SUBMITTED, JobState.ACCEPTED, JobState.QUEUED, JobState.CLOSED]) {
      expect(customerMayEdit(job(state, CustomerActionRequired.EDIT_WORKFLOW))).toBe(false);
    }
  });
});

describe('jobIsWithCustomer / awaitingCustomerApproval', () => {
  it('separates holding the job from being asked to approve it', () => {
    expect(jobIsWithCustomer(job(JobState.CHANGES_REQUESTED))).toBe(true);
    expect(jobIsWithCustomer(job(JobState.SUBMITTED))).toBe(false);
    expect(awaitingCustomerApproval(job(JobState.CHANGES_REQUESTED, CustomerActionRequired.APPROVE_WORKFLOW))).toBe(true);
    expect(awaitingCustomerApproval(job(JobState.CHANGES_REQUESTED, CustomerActionRequired.EDIT_WORKFLOW))).toBe(false);
  });
});

describe('staffMayEdit', () => {
  it('allows the states where the lab holds an uncommitted job', () => {
    for (const state of [JobState.CREATING, JobState.SUBMITTED, JobState.QUEUED, JobState.IN_PROGRESS, JobState.COMPLETE]) {
      expect(staffMayEdit(job(state))).toBe(true);
    }
  });

  // The two that used to be open and caused the trouble: editing a job the
  // customer is holding, and moving a spec out from under its acceptance.
  it('refuses while the customer holds it and once the spec is accepted', () => {
    expect(staffMayEdit(job(JobState.CHANGES_REQUESTED))).toBe(false);
    expect(staffMayEdit(job(JobState.ACCEPTED))).toBe(false);
  });

  it('refuses on terminal states', () => {
    expect(staffMayEdit(job(JobState.CLOSED))).toBe(false);
    expect(staffMayEdit(job(JobState.REJECTED))).toBe(false);
  });
});

describe('staffEditBlockedReason', () => {
  it('names the action that would unblock them', () => {
    expect(staffEditBlockedReason(job(JobState.CHANGES_REQUESTED))).toMatch(/Withdraw it from them/);
    expect(staffEditBlockedReason(job(JobState.ACCEPTED))).toMatch(/Withdraw the acceptance/);
  });

  it('is null when nothing is in the way', () => {
    expect(staffEditBlockedReason(job(JobState.SUBMITTED))).toBeNull();
  });
});

describe('assertJobContractWritable', () => {
  it('lets staff write an uncommitted job they hold', () => {
    expect(() => assertJobContractWritable(job(JobState.SUBMITTED), STAFF)).not.toThrow();
  });

  it('refuses staff while the customer holds it or the spec is accepted', () => {
    expect(() => assertJobContractWritable(job(JobState.CHANGES_REQUESTED, CustomerActionRequired.EDIT_WORKFLOW), STAFF)).toThrow(ForbiddenException);
    expect(() => assertJobContractWritable(job(JobState.ACCEPTED), STAFF)).toThrow(ForbiddenException);
  });

  it('lets the owner write only when asked for edits', () => {
    expect(() => assertJobContractWritable(job(JobState.CHANGES_REQUESTED, CustomerActionRequired.EDIT_WORKFLOW), OWNER)).not.toThrow();
    expect(() => assertJobContractWritable(job(JobState.CHANGES_REQUESTED, CustomerActionRequired.APPROVE_WORKFLOW), OWNER)).toThrow(ForbiddenException);
    expect(() => assertJobContractWritable(job(JobState.SUBMITTED), OWNER)).toThrow(ForbiddenException);
  });

  it('refuses anyone who neither owns the job nor works at the lab', () => {
    expect(() => assertJobContractWritable(job(JobState.CHANGES_REQUESTED, CustomerActionRequired.EDIT_WORKFLOW), STRANGER)).toThrow(/do not have permission/);
  });

  // The whole point: the two parties are never writable at the same moment.
  it('never lets both sides write the same job at once', () => {
    const states = [JobState.CREATING, JobState.SUBMITTED, JobState.CHANGES_REQUESTED, JobState.ACCEPTED, JobState.QUEUED, JobState.IN_PROGRESS, JobState.COMPLETE, JobState.CLOSED, JobState.REJECTED];
    const actions = [null, CustomerActionRequired.REPLY, CustomerActionRequired.EDIT_WORKFLOW, CustomerActionRequired.APPROVE_WORKFLOW];

    for (const state of states) {
      for (const action of actions) {
        const candidate = job(state, action);
        const staffCan = staffMayEdit(candidate);
        const customerCan = customerMayEdit(candidate);
        expect(staffCan && customerCan).toBe(false);
      }
    }
  });
});
