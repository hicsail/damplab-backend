import { HttpException, HttpStatus } from '@nestjs/common';
import { AclidScreenPendingError } from '../aclid/aclid.service';
import { JobScreeningService } from './job-screening.service';
import { HomologyScreeningStatus, Job } from './job.model';
import { GIBSON_ASSEMBLY_SERVICE_NAME, M_CLONING_SERVICE_NAME } from './job-screening.constants';

const WORKFLOW_ID = '65a1b2c3d4e5f60718293a4b';
const DNA_A = 'ATGGCGCGTACGTAGCTAGCTAGCATCGATCGATCGTAGCTAGCTAGCTAGCATCGATCGG';
const DNA_B = 'TTTACGCGTACGTAGCTAGCTAGCATCGATCGATCGTAGCTAGCTAGCTAGCATCGAAAA';
/** 23 bp: long enough to look like DNA, too short for Aclid's 30 bp floor. */
const DNA_SHORT = 'ATGGCGCGTACGTAGCTAGCTAG';

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
    setAclidScreening: jest.Mock;
    appendScreeningBatchId: jest.Mock;
    aclidConfigured: boolean;
    screenInline: jest.Mock;
    job: Partial<Job> | null;
  }> = {}
): {
  service: JobScreeningService;
  job: Job | null;
  setHomologyScreening: jest.Mock;
  setAclidScreening: jest.Mock;
  appendScreeningBatchId: jest.Mock;
  screenSequences: jest.Mock;
  screenInline: jest.Mock;
} {
  const job = overrides.job === undefined ? ({ _id: 'job-1', workflows: [WORKFLOW_ID] } as unknown as Job) : (overrides.job as Job | null);

  const setHomologyScreening = overrides.setHomologyScreening ?? jest.fn(async () => job);
  const setAclidScreening = overrides.setAclidScreening ?? jest.fn(async () => job);
  const appendScreeningBatchId = overrides.appendScreeningBatchId ?? jest.fn(async () => job);
  const jobService: any = { findById: jest.fn(async () => job), setHomologyScreening, setAclidScreening, appendScreeningBatchId };

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

  const screenInline = overrides.screenInline ?? jest.fn();
  const aclidService: any = { isConfigured: () => overrides.aclidConfigured ?? false, screenInline, getScreen: jest.fn() };

  const service = new JobScreeningService(jobService, workflowService, workflowNodeService, dampLabServices, secureDnaService, aclidService);
  return { service, job, setHomologyScreening, setAclidScreening, appendScreeningBatchId, screenSequences, screenInline };
}

const lastCall = (mock: jest.Mock): any => mock.mock.calls[mock.mock.calls.length - 1][1];
const firstArg = (mock: jest.Mock): any => mock.mock.calls[0][0];
const lastStatus = (setHomologyScreening: jest.Mock): { status: string } => lastCall(setHomologyScreening);

/** A finished Aclid screen, with only the fields a test cares about overridden. */
function aclidScreen(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'scr_1',
    status: 'succeeded',
    regulatoryStatus: 'not_controlled',
    verificationStatus: 'pending',
    decisionStatus: null,
    verificationCompletedAt: null,
    findings: null,
    ...overrides
  };
}

const granted = {
  id: '65a1b2c3d4e5f60718293a4c',
  synthesisPermission: 'granted',
  errors: [],
  sequences: [{ threats: [] }]
};

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

describe('screenJob homology mode', () => {
  const gibson = [{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_A }] }];
  const originalMode = process.env.BIOSECURITY_HOMOLOGY_MODE;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.BIOSECURITY_HOMOLOGY_MODE;
    else process.env.BIOSECURITY_HOMOLOGY_MODE = originalMode;
  });

  it('in aclid mode records Passed from not_controlled and does not call SecureDNA', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const screenInline = jest.fn(async () => aclidScreen());
    const screenSequences = jest.fn();
    const { service, setHomologyScreening, setAclidScreening } = harness(gibson, { aclidConfigured: true, screenInline, screenSequences });

    const result = await service.screenJob('job-1', 'user-1');

    expect(screenSequences).not.toHaveBeenCalled();
    expect(result.status).toBe(HomologyScreeningStatus.PASSED);
    expect(result.batchId).toBeNull();
    expect(result.detail).toContain('Aclid not_controlled');
    expect(lastStatus(setHomologyScreening).status).toBe(HomologyScreeningStatus.PASSED);

    const aclid = lastCall(setAclidScreening);
    expect(aclid.screenId).toBe('scr_1');
    expect(aclid.homologyStatus).toBe(HomologyScreeningStatus.PASSED);
    expect(aclid.sequenceCount).toBe(1);
    // Verification is pending, so the customer still has KYC to do.
    expect(aclid.customerStatus).toBe(HomologyScreeningStatus.IN_PROGRESS);
  });

  it('in aclid mode runs SecureDNA when screenInline throws', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const screenInline = jest.fn(async () => {
      throw new HttpException('Could not reach Aclid at https://api.aclid.bio/v2/screen_inline: fetch failed', HttpStatus.SERVICE_UNAVAILABLE);
    });
    const screenSequences = jest.fn(async () => granted);
    const { service, setAclidScreening, appendScreeningBatchId } = harness(gibson, { aclidConfigured: true, screenInline, screenSequences });

    const result = await service.screenJob('job-1', 'user-1');

    expect(screenSequences).toHaveBeenCalled();
    expect(appendScreeningBatchId).toHaveBeenCalled();
    expect(result.status).toBe(HomologyScreeningStatus.PASSED);
    expect(result.detail).toContain('SecureDNA backup after Aclid error');
    expect(result.detail).toContain('Could not reach Aclid');

    // A transport failure is never a verdict: the Aclid row is Unavailable.
    const aclid = lastCall(setAclidScreening);
    expect(aclid.screenId).toBeNull();
    expect(aclid.homologyStatus).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(aclid.customerStatus).toBe(HomologyScreeningStatus.UNAVAILABLE);
  });

  /**
   * `failed`, `deleted` and `archived` are terminal, so `screenInline` resolves
   * with such a screen rather than throwing. No regulatory status is no verdict,
   * which is exactly what the backup exists for.
   */
  it('in aclid mode runs SecureDNA when Aclid finishes without a regulatory status', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const screenInline = jest.fn(async () => aclidScreen({ status: 'failed', regulatoryStatus: null }));
    const screenSequences = jest.fn(async () => granted);
    const { service, setAclidScreening } = harness(gibson, { aclidConfigured: true, screenInline, screenSequences });

    const result = await service.screenJob('job-1', 'user-1');

    expect(screenSequences).toHaveBeenCalled();
    expect(result.status).toBe(HomologyScreeningStatus.PASSED);
    expect(result.detail).toContain('SecureDNA backup after Aclid error');
    expect(result.detail).toContain('screen failed without a regulatory status');

    // The screen still exists, so KYC still has something to hang off.
    const aclid = lastCall(setAclidScreening);
    expect(aclid.screenId).toBe('scr_1');
    expect(aclid.homologyStatus).toBe(HomologyScreeningStatus.UNAVAILABLE);
  });

  /**
   * A regulatory status we cannot map is no more an answer than a missing one.
   * Without this, a new Aclid enum would quietly disable the backup fleet-wide.
   */
  it('in aclid mode runs SecureDNA when Aclid reports a regulatory status we do not recognise', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const screenInline = jest.fn(async () => aclidScreen({ regulatoryStatus: 'pending_review' }));
    const screenSequences = jest.fn(async () => granted);
    const { service, setAclidScreening } = harness(gibson, { aclidConfigured: true, screenInline, screenSequences });

    const result = await service.screenJob('job-1', 'user-1');

    expect(screenSequences).toHaveBeenCalled();
    expect(result.status).toBe(HomologyScreeningStatus.PASSED);
    expect(result.detail).toContain('SecureDNA backup after Aclid error');
    expect(result.detail).toContain('screen succeeded reported pending_review');

    const aclid = lastCall(setAclidScreening);
    expect(aclid.screenId).toBe('scr_1');
    expect(aclid.homologyStatus).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(aclid.detail).toContain('pending_review');
  });

  /**
   * "Took longer than two minutes" is an expected outcome from an asynchronous
   * provider, not an exceptional one. The screen exists, so the record keeps its
   * id and says In Progress — KYC can start, and a refresh can finish it.
   */
  it('in aclid mode records the screen id and In Progress when the poll budget runs out', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const screenInline = jest.fn(async () => {
      throw new AclidScreenPendingError(aclidScreen({ status: 'running', regulatoryStatus: null }) as any, 'did not finish within 120000 ms');
    });
    const screenSequences = jest.fn(async () => granted);
    const { service, setAclidScreening } = harness(gibson, { aclidConfigured: true, screenInline, screenSequences });

    const result = await service.screenJob('job-1', 'user-1');

    const aclid = lastCall(setAclidScreening);
    expect(aclid.screenId).toBe('scr_1');
    expect(aclid.homologyStatus).toBe(HomologyScreeningStatus.IN_PROGRESS);
    expect(aclid.completedAt).toBeNull();
    expect(aclid.detail).toBe('Aclid screen still running');
    // The screen id is what KYC hangs off, so the customer can verify now.
    expect(aclid.customerStatus).toBe(HomologyScreeningStatus.IN_PROGRESS);

    // No verdict yet, so the backup still runs and the Homology row settles.
    expect(screenSequences).toHaveBeenCalled();
    expect(result.status).toBe(HomologyScreeningStatus.PASSED);
    expect(result.detail).toContain('SecureDNA backup after Aclid error');
  });

  it('in both mode Fails homology if Aclid is controlled even when SecureDNA grants', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'both';
    const screenInline = jest.fn(async () => aclidScreen({ regulatoryStatus: 'controlled' }));
    const screenSequences = jest.fn(async () => granted);
    const { service, setHomologyScreening, setAclidScreening } = harness(gibson, { aclidConfigured: true, screenInline, screenSequences });

    const result = await service.screenJob('job-1', 'user-1');

    expect(screenInline).toHaveBeenCalled();
    expect(screenSequences).toHaveBeenCalled();
    expect(result.status).toBe(HomologyScreeningStatus.FAILED);
    expect(result.detail).toContain('Aclid controlled');
    expect(lastStatus(setHomologyScreening).status).toBe(HomologyScreeningStatus.FAILED);
    expect(lastCall(setAclidScreening).homologyStatus).toBe(HomologyScreeningStatus.FAILED);
  });

  it('in securedna mode still creates an Aclid screen when configured', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'securedna';
    // Controlled, and yet the Homology row is SecureDNA's alone in this mode:
    // the screen exists here only so the customer has a KYC target.
    const screenInline = jest.fn(async () => aclidScreen({ regulatoryStatus: 'controlled' }));
    const screenSequences = jest.fn(async () => granted);
    const { service, setAclidScreening } = harness(gibson, { aclidConfigured: true, screenInline, screenSequences });

    const result = await service.screenJob('job-1', 'user-1');

    expect(screenInline).toHaveBeenCalled();
    expect(screenSequences).toHaveBeenCalled();
    expect(result.status).toBe(HomologyScreeningStatus.PASSED);
    expect(result.detail).toBeNull();
    expect(lastCall(setAclidScreening).screenId).toBe('scr_1');
  });

  it('omits sequences shorter than 30 bp from the Aclid payload', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const screenInline = jest.fn(async () => aclidScreen());
    const { service, setAclidScreening } = harness(
      [
        { id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_A }] },
        { id: 'n2', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_SHORT }] }
      ],
      { aclidConfigured: true, screenInline }
    );

    await service.screenJob('job-1', 'user-1');

    expect(screenInline).toHaveBeenCalledTimes(1);
    expect(firstArg(screenInline).sequences).toEqual([{ name: `${WORKFLOW_ID}_n1_insert`, sequence: DNA_A }]);
    expect(lastCall(setAclidScreening).sequenceCount).toBe(1);
  });

  /**
   * Nothing for Aclid to screen is not a verdict either: the Aclid row says so,
   * and SecureDNA — which has no 30 bp floor — still screens the job.
   */
  it('in aclid mode runs SecureDNA when no sequence is long enough for Aclid', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const screenInline = jest.fn();
    const screenSequences = jest.fn(async () => granted);
    const { service, setAclidScreening } = harness([{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_SHORT }] }], {
      aclidConfigured: true,
      screenInline,
      screenSequences
    });

    const result = await service.screenJob('job-1', 'user-1');

    expect(screenInline).not.toHaveBeenCalled();
    expect(firstArg(screenSequences).sequences).toEqual([{ name: `${WORKFLOW_ID}_n1_insert`, seq: DNA_SHORT }]);
    expect(result.status).toBe(HomologyScreeningStatus.PASSED);
    expect(result.detail).toBe('SecureDNA (no Aclid-eligible sequences)');
    expect(result.detail).not.toContain('after Aclid error');

    const aclid = lastCall(setAclidScreening);
    expect(aclid.homologyStatus).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(aclid.detail).toContain('shorter than 30 bp');
  });
});
