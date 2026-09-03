import mongoose from 'mongoose';
import { JobService } from './job.service';
import { JobState } from './job.model';

/**
 * The lab boards must not show work the customer has not contracted for.
 *
 * The gate is the SOW collection, not the job's state: `WAITING_FOR_SOW` and
 * `QUEUED` are declared on `JobState` but nothing in the codebase ever assigns
 * them, so an accepted job sits at ACCEPTED whether or not an SOW exists — which
 * is exactly how unsigned work reached the monitors.
 *
 * `SIGNED` and `FINAL` both count as signed. Countersigning moves SIGNED → FINAL
 * (`SowVersionService.finalize`), so gating on SIGNED alone would make a job
 * vanish from the boards the moment staff countersigned it.
 */

const objectId = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

interface JobRow {
  _id: mongoose.Types.ObjectId;
  workflows: mongoose.Types.ObjectId[];
}

function serviceWith(jobs: JobRow[], signedJobIds: string[]): { service: JobService; jobFilter: () => any } {
  let capturedFilter: any = null;

  const jobModel = {
    find: (filter: any): any => {
      capturedFilter = filter;
      const states: JobState[] = filter.state?.$in ?? [];
      return {
        select: () => ({
          lean: () => ({
            // Every seeded job is in an approved state; the state filter itself is
            // asserted separately below.
            exec: async () => (states.length ? jobs : [])
          })
        })
      };
    }
  };

  const sowService = {
    findSignedJobIds: jest.fn(async (jobIds: string[]) => jobIds.filter((id) => signedJobIds.includes(id)))
  };

  const service = new JobService(jobModel as any, {} as any, {} as any, sowService as any);
  return { service, jobFilter: () => capturedFilter };
}

describe('getWorkflowIdsForApprovedJobs — signed-SOW gate', () => {
  const signedJob: JobRow = { _id: objectId(), workflows: [objectId()] };
  const unsignedJob: JobRow = { _id: objectId(), workflows: [objectId()] };
  const noSowJob: JobRow = { _id: objectId(), workflows: [objectId()] };
  const jobs = [signedJob, unsignedJob, noSowJob];
  const signed = [signedJob._id.toString()];

  const idsOf = (rows: JobRow[]): string[] => rows.flatMap((j) => j.workflows.map((w) => w.toString())).sort();

  it('returns only workflows whose job has a signed SOW', async () => {
    const { service } = serviceWith(jobs, signed);

    const result = await service.getWorkflowIdsForApprovedJobs();

    expect(result.map(String).sort()).toEqual(idsOf([signedJob]));
  });

  it('hides a job with no SOW at all, not just one that is unsigned', async () => {
    const { service } = serviceWith([noSowJob], []);

    expect(await service.getWorkflowIdsForApprovedJobs()).toEqual([]);
  });

  it('returns every approved job when the staff override is set', async () => {
    const { service } = serviceWith(jobs, signed);

    const result = await service.getWorkflowIdsForApprovedJobs({ includeUnsignedSow: true });

    expect(result.map(String).sort()).toEqual(idsOf(jobs));
  });

  it('skips the SOW lookup entirely when overridden', async () => {
    const { service } = serviceWith(jobs, signed);
    const sowService: any = (service as any).sowService;

    await service.getWorkflowIdsForApprovedJobs({ includeUnsignedSow: true });

    expect(sowService.findSignedJobIds).not.toHaveBeenCalled();
  });

  it('asks the SOW collection once, for every candidate job', async () => {
    // A per-job lookup would be N round trips behind a polling TV board.
    const { service } = serviceWith(jobs, signed);
    const sowService: any = (service as any).sowService;

    await service.getWorkflowIdsForApprovedJobs();

    expect(sowService.findSignedJobIds).toHaveBeenCalledTimes(1);
    expect(sowService.findSignedJobIds.mock.calls[0][0].sort()).toEqual(jobs.map((j) => j._id.toString()).sort());
  });

  it('still excludes archived jobs and unapproved states', async () => {
    const { service, jobFilter } = serviceWith(jobs, signed);

    await service.getWorkflowIdsForApprovedJobs();

    expect(jobFilter().isArchived).toEqual({ $ne: true });
    expect(jobFilter().state.$in).toEqual(expect.arrayContaining([JobState.ACCEPTED, JobState.IN_PROGRESS, JobState.COMPLETE]));
    expect(jobFilter().state.$in).not.toContain(JobState.CLOSED);
    expect(jobFilter().state.$in).not.toContain(JobState.CANCELLED);
  });
});
