import { JobScreeningService } from './job-screening.service';
import { HomologyScreeningStatus, Job } from './job.model';
import { GIBSON_ASSEMBLY_SERVICE_NAME, M_CLONING_SERVICE_NAME } from './job-screening.constants';

const WORKFLOW_ID = '65a1b2c3d4e5f60718293a4b';
const DNA_A = 'ATGGCGCGTACGTAGCTAGCTAGCATCGATCGATCGTAGCTAGCTAGCTAGCATCGATCGG';
const DNA_B = 'TTTACGCGTACGTAGCTAGCTAGCATCGATCGATCGTAGCTAGCTAGCTAGCATCGAAAA';

/**
 * A job whose single workflow holds `nodes`, each bound to a named service with
 * the given formData. Mirrors the shape the real services return, which is all
 * `collectScreeningTargets` reads.
 */
function harness(
  nodes: Array<{ id: string; serviceName: string; formData: unknown }>,
  overrides: Partial<{
    screenSequences: jest.Mock;
    setHomologyScreening: jest.Mock;
    appendScreeningBatchId: jest.Mock;
    job: Partial<Job> | null;
  }> = {}
): {
  service: JobScreeningService;
  job: Job | null;
  setHomologyScreening: jest.Mock;
  appendScreeningBatchId: jest.Mock;
  screenSequences: jest.Mock;
} {
  const job = overrides.job === undefined ? ({ _id: 'job-1', workflows: [WORKFLOW_ID] } as unknown as Job) : (overrides.job as Job | null);

  const setHomologyScreening = overrides.setHomologyScreening ?? jest.fn(async () => job);
  const appendScreeningBatchId = overrides.appendScreeningBatchId ?? jest.fn(async () => job);
  const jobService: any = { findById: jest.fn(async () => job), setHomologyScreening, appendScreeningBatchId };

  const workflowService: any = {
    findByIds: jest.fn(async () => [{ _id: WORKFLOW_ID, nodes: nodes.map((n) => ({ _id: n.id })) }])
  };
  const workflowNodeService: any = {
    getByIDs: jest.fn(async () => nodes.map((n) => ({ _id: n.id, id: n.id, service: `svc-${n.id}`, formData: n.formData })))
  };
  const dampLabServices: any = {
    findOne: jest.fn(async (id: string) => {
      const node = nodes.find((n) => `svc-${n.id}` === id);
      return node ? { name: node.serviceName, parameters: [] } : null;
    })
  };
  const screenSequences = overrides.screenSequences ?? jest.fn();
  const secureDnaService: any = { screenSequences };

  const service = new JobScreeningService(jobService, workflowService, workflowNodeService, dampLabServices, secureDnaService);
  return { service, job, setHomologyScreening, appendScreeningBatchId, screenSequences };
}

const lastStatus = (setHomologyScreening: jest.Mock): { status: string } => setHomologyScreening.mock.calls[setHomologyScreening.mock.calls.length - 1][1];

describe('collectScreeningTargets', () => {
  it('takes only the insert from Gibson Assembly — its vector is a file upload', async () => {
    const { service, job } = harness([
      {
        id: 'n1',
        serviceName: GIBSON_ASSEMBLY_SERVICE_NAME,
        formData: [
          { id: 'insert', value: DNA_A },
          { id: 'vector', value: DNA_B }
        ]
      }
    ]);
    const targets = await service.collectScreeningTargets(job!);
    expect(targets).toEqual([{ name: `${WORKFLOW_ID}_n1_insert`, seq: DNA_A }]);
  });

  it('takes vector then insert from Modular Cloning', async () => {
    const { service, job } = harness([
      {
        id: 'n1',
        serviceName: M_CLONING_SERVICE_NAME,
        formData: [
          { id: 'insert', value: DNA_A },
          { id: 'vector', value: DNA_B }
        ]
      }
    ]);
    const targets = await service.collectScreeningTargets(job!);
    expect(targets.map((t) => t.name)).toEqual([`${WORKFLOW_ID}_n1_vector`, `${WORKFLOW_ID}_n1_insert`]);
  });

  it('ignores services that carry no screenable sequence', async () => {
    const { service, job } = harness([{ id: 'n1', serviceName: 'Pooling', formData: [{ id: 'insert', value: DNA_A }] }]);
    expect(await service.collectScreeningTargets(job!)).toEqual([]);
  });

  it('skips a sequence field holding something that is not DNA', async () => {
    const { service, job } = harness([
      {
        id: 'n1',
        serviceName: M_CLONING_SERVICE_NAME,
        formData: [
          { id: 'vector', value: 'will email this separately' },
          { id: 'insert', value: DNA_A }
        ]
      }
    ]);
    const targets = await service.collectScreeningTargets(job!);
    expect(targets.map((t) => t.name)).toEqual([`${WORKFLOW_ID}_n1_insert`]);
  });

  it('collects across several nodes', async () => {
    const { service, job } = harness([
      { id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_A }] },
      {
        id: 'n2',
        serviceName: M_CLONING_SERVICE_NAME,
        formData: [
          { id: 'insert', value: DNA_B },
          { id: 'vector', value: DNA_A }
        ]
      }
    ]);
    expect((await service.collectScreeningTargets(job!)).length).toBe(3);
  });
});

describe('screenJob', () => {
  const gibson = [{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_A }] }];

  it('records PASSED when SecureDNA grants synthesis', async () => {
    const screenSequences = jest.fn(async () => ({
      id: '65a1b2c3d4e5f60718293a4c',
      synthesisPermission: 'granted',
      errors: [],
      sequences: [{ threats: [] }]
    }));
    const { service, setHomologyScreening, appendScreeningBatchId } = harness(gibson, { screenSequences });

    const result = await service.screenJob('job-1', 'user-1');

    expect(result.status).toBe(HomologyScreeningStatus.PASSED);
    expect(result.sequenceCount).toBe(1);
    expect(appendScreeningBatchId).toHaveBeenCalled();
    expect(lastStatus(setHomologyScreening).status).toBe(HomologyScreeningStatus.PASSED);
  });

  it('writes IN_PROGRESS before calling SecureDNA, so the card is never blank while it runs', async () => {
    const seen: string[] = [];
    const setHomologyScreening = jest.fn(async (_id: string, s: { status: string }) => {
      seen.push(s.status);
      return null;
    });
    const screenSequences = jest.fn(async () => {
      expect(seen).toEqual([HomologyScreeningStatus.IN_PROGRESS]);
      return { id: '65a1b2c3d4e5f60718293a4c', synthesisPermission: 'granted', errors: [], sequences: [{ threats: [] }] };
    });
    const { service } = harness(gibson, { screenSequences, setHomologyScreening });

    await service.screenJob('job-1', 'user-1');
    expect(seen).toEqual([HomologyScreeningStatus.IN_PROGRESS, HomologyScreeningStatus.PASSED]);
  });

  it('records FAILED, and says how many sequences were flagged, when synthesis is denied', async () => {
    const screenSequences = jest.fn(async () => ({
      id: '65a1b2c3d4e5f60718293a4c',
      synthesisPermission: 'denied',
      errors: [],
      sequences: [{ threats: ['hazard'] }]
    }));
    const { service } = harness(gibson, { screenSequences });

    const result = await service.screenJob('job-1', 'user-1');
    expect(result.status).toBe(HomologyScreeningStatus.FAILED);
    expect(result.detail).toContain('1 of 1');
  });

  /**
   * The distinction the card's four icons exist for: a red X means the sequence
   * failed screening. Not being able to screen at all is a question mark.
   */
  it('records UNAVAILABLE, not FAILED, when SecureDNA cannot be reached', async () => {
    const screenSequences = jest.fn(async () => {
      throw new Error('Could not reach SecureDNA at http://127.0.0.1:8787/v1/screen: fetch failed');
    });
    const { service } = harness(gibson, { screenSequences });

    const result = await service.screenJob('job-1', 'user-1');
    expect(result.status).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(result.detail).toContain('Could not reach SecureDNA');
  });

  it('records UNAVAILABLE when SecureDNA returns diagnostics instead of screening', async () => {
    const screenSequences = jest.fn(async () => ({
      id: '65a1b2c3d4e5f60718293a4c',
      synthesisPermission: 'granted',
      errors: [{ diagnostic: 'invalid_input', additional_info: 'bad record' }],
      sequences: [{ threats: [] }]
    }));
    const { service } = harness(gibson, { screenSequences });

    const result = await service.screenJob('job-1', 'user-1');
    expect(result.status).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(result.detail).toContain('1 error');
  });

  it('records UNAVAILABLE without calling SecureDNA when the job has no sequences', async () => {
    const screenSequences = jest.fn();
    const { service } = harness([{ id: 'n1', serviceName: 'Pooling', formData: [] }], { screenSequences });

    const result = await service.screenJob('job-1', 'user-1');
    expect(result.status).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(result.sequenceCount).toBe(0);
    expect(screenSequences).not.toHaveBeenCalled();
  });

  it('never rejects, so a fire-and-forget dispatch cannot produce an unhandled rejection', async () => {
    const screenSequences = jest.fn(async () => {
      throw new Error('boom');
    });
    const { service } = harness(gibson, { screenSequences });
    await expect(service.screenJob('job-1', 'user-1')).resolves.toBeDefined();
  });
});
