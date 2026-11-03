import { CustomerActionRequired, JobState } from './job.model';
import { reopenTarget } from './job-reopen';

const v = (versionNumber: number, jobState?: JobState): any => ({ versionNumber, jobState });

describe('reopenTarget — where a closed job goes back to', () => {
  it('the state it was closed from, with the customer action it had, when the close recorded them', () => {
    const job: any = { state: JobState.CLOSED, closedFromState: JobState.CHANGES_REQUESTED, closedFromCustomerAction: CustomerActionRequired.EDIT_WORKFLOW };
    expect(reopenTarget(job, [])).toEqual({ state: JobState.CHANGES_REQUESTED, customerActionRequired: CustomerActionRequired.EDIT_WORKFLOW });
  });

  it('for a job closed before the close recorded it: the last state in its history before it was closed', () => {
    const job: any = { state: JobState.CLOSED };
    // Job 00092: submitted, changes requested, closed.
    const history = [v(1000, JobState.SUBMITTED), v(2000, JobState.CHANGES_REQUESTED), v(2001, JobState.CLOSED)];
    expect(reopenTarget(job, history)).toEqual({ state: JobState.CHANGES_REQUESTED, customerActionRequired: null });
    // Versions without a state, and out of order, are skipped.
    expect(reopenTarget(job, [v(2001, JobState.CLOSED), v(1001), v(1000, JobState.ACCEPTED)])).toEqual({ state: JobState.ACCEPTED, customerActionRequired: null });
  });

  it('is null — reopening refused — when the job is not closed, or nothing says where it was', () => {
    expect(reopenTarget({ state: JobState.ACCEPTED } as any, [v(1000, JobState.SUBMITTED)])).toBeNull();
    expect(reopenTarget({ state: JobState.CLOSED } as any, [v(1000, JobState.CLOSED)])).toBeNull();
    expect(reopenTarget({ state: JobState.CLOSED, closedFromState: JobState.CLOSED } as any, [])).toBeNull();
  });
});
