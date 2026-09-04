import { JobService } from './job.service';
import { JobState } from './job.model';
import { JobsForViewerInput, JobScope } from './dto/jobs-query.dto';

/**
 * The jobs listing hides closed-out jobs unless asked.
 *
 * Server-side, not in the browser: filtering the returned page would leave
 * `totalCount` counting rows the reader cannot see, and pagination would show
 * short pages.
 *
 * `COMPLETE` is deliberately not in the hidden set. A job whose lab work has
 * finished is usually still being wrapped up and billed, so dropping it out of
 * the default view the moment work ends is a different decision from hiding the
 * three states that mean the job is done being looked at.
 */

const CLOSED = [JobState.CLOSED, JobState.CANCELLED, JobState.REJECTED];

function serviceCapturingMatch(): { service: JobService; stages: () => any[] } {
  let pipeline: any[] = [];
  const jobModel = {
    aggregate: (stages: any[]): any => {
      pipeline = stages;
      return { exec: async () => [{ totalCount: [{ n: 0 }], items: [] }] };
    }
  };
  const service = new JobService(jobModel as any, {} as any, {} as any, {} as any);
  return { service, stages: () => pipeline };
}

/** The `$and` clauses of the leading `$match`, however the pipeline chose to shape it. */
function matchClauses(stages: any[]): any[] {
  const match = stages[0].$match;
  return match.$and ?? [match];
}

async function run(input: Partial<JobsForViewerInput>): Promise<any[]> {
  const { service, stages } = serviceCapturingMatch();
  await service.findJobsForViewer({ scope: JobScope.ALL, ...input } as JobsForViewerInput, { scope: JobScope.ALL, viewerSub: 'staff-1' });
  return matchClauses(stages());
}

describe('jobs listing hides closed jobs by default', () => {
  it('excludes CLOSED, CANCELLED and REJECTED when nothing is asked for', async () => {
    const clauses = await run({});

    expect(clauses).toContainEqual({ state: { $nin: CLOSED } });
  });

  it('keeps COMPLETE visible', async () => {
    const clauses = await run({});
    const exclusion = clauses.find((c) => c.state?.$nin);

    expect(exclusion.state.$nin).not.toContain(JobState.COMPLETE);
  });

  it('includes everything when includeClosed is set', async () => {
    const clauses = await run({ includeClosed: true });

    expect(clauses.find((c) => c.state?.$nin)).toBeUndefined();
  });

  it('lets an explicit state filter through, even a closed one', async () => {
    // Otherwise the state dropdown could never reach a closed job: an exclusion
    // and an equality on the same field would match nothing.
    const clauses = await run({ state: JobState.CLOSED });

    expect(clauses).toContainEqual({ state: JobState.CLOSED });
    expect(clauses.find((c) => c.state?.$nin)).toBeUndefined();
  });
});
