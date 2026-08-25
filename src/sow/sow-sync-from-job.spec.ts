import { SOWService } from './sow.service';

/**
 * The job-graph sync that keeps a SOW's billing core in step with live workflows.
 *
 * It rewrites sow.services (the parent working copy) and flags the document stale.
 * It must not invent a new version — versions stay frozen until staff Save.
 */

interface Harness {
  service: SOWService;
  updates: Array<{ id: string; input: { services?: unknown } }>;
  staleRefreshes: string[];
}

function harness(opts: { job?: unknown; sow?: unknown; services?: unknown[] } = {}): Harness {
  const updates: Harness['updates'] = [];
  const staleRefreshes: string[] = [];

  const sow = opts.sow === undefined ? { _id: 'sow1', jobId: 'job1', services: [{ id: 'old' }] } : opts.sow;
  const job = opts.job === undefined ? { _id: 'job1' } : opts.job;

  const sowModel: any = {
    findOne: () => ({ exec: async () => sow })
  };
  const jobService: any = {
    findById: async () => job
  };
  const sowVersionService: any = {
    refreshDocumentStale: async (id: string) => {
      staleRefreshes.push(id);
      return true;
    }
  };

  const service = new SOWService(sowModel, {} as any, jobService, sowVersionService, {} as any, {} as any);
  (service as any).collectSowServiceInputs = async (): Promise<unknown[]> => opts.services ?? [{ id: 'svc-a', name: 'PCR', cost: 10, formData: [] }];
  (service as any).update = async (id: string, input: { services?: unknown }): Promise<unknown> => {
    updates.push({ id, input });
    return sow;
  };

  return { service, updates, staleRefreshes };
}

describe('syncServicesFromJobWorkflows', () => {
  it('is a no-op when the job is missing', async () => {
    const { service, updates, staleRefreshes } = harness({ job: null });

    await service.syncServicesFromJobWorkflows('job1');

    expect(updates).toEqual([]);
    expect(staleRefreshes).toEqual([]);
  });

  it('is a no-op when the job has no SOW', async () => {
    const { service, updates, staleRefreshes } = harness({ sow: null });

    await service.syncServicesFromJobWorkflows('job1');

    expect(updates).toEqual([]);
    expect(staleRefreshes).toEqual([]);
  });

  it('is a no-op when the job currently implies no service lines', async () => {
    const { service, updates, staleRefreshes } = harness({ services: [] });

    await service.syncServicesFromJobWorkflows('job1');

    expect(updates).toEqual([]);
    expect(staleRefreshes).toEqual([]);
  });

  it('rewrites the parent billing core from the live job and flags the document stale', async () => {
    const services = [{ id: 'svc-a', name: 'PCR', cost: 42, formData: [{ id: 'vol', value: 10 }] }];
    const { service, updates, staleRefreshes } = harness({ services });

    await service.syncServicesFromJobWorkflows('job1');

    expect(updates).toEqual([{ id: 'sow1', input: { services } }]);
    expect(staleRefreshes).toEqual(['sow1']);
  });
});
