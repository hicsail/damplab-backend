import { HttpException, HttpStatus } from '@nestjs/common';
import { AclidCustomerPendingError, AclidFeatureNotEnabledError, AclidScreenPendingError } from '../aclid/aclid.service';
import { AUTO_SCREENING_ENABLED, JobScreeningService } from './job-screening.service';
import { HomologyScreeningStatus, Job, JobState } from './job.model';
import { ObjectTooLargeError } from '../workflow/services/workflow-parameter-files.service';
import { fileRecordSliceName } from './job-screening-name.util';
import { CustomerScreeningStatus, JobAcceptanceScreeningState, ScreeningRunTrigger } from './screening-run.model';
import { ACCEPTANCE_MESSAGES, decideAcceptanceScreening } from './screening-acceptance.util';

const GIBSON_ASSEMBLY_SERVICE_NAME = 'Gibson Assembly';
const M_CLONING_SERVICE_NAME = 'Modular Cloning';
const ORDERING_DNA_FRAGMENTS_SERVICE_NAME = 'Ordering DNA Fragments from third-party';

/** The four parameters the human flags by hand after deploy (design, "Decided with the human"), plus unflagged neighbours. */
const PARAMETERS_BY_SERVICE: Record<string, any[]> = {
  [GIBSON_ASSEMBLY_SERVICE_NAME]: [
    { id: 'insert', name: 'Insert', type: 'string', screening: true },
    { id: 'vector', name: 'Vector', type: 'string' }
  ],
  [M_CLONING_SERVICE_NAME]: [
    { id: 'vector', name: 'Vector', type: 'string', screening: true },
    { id: 'insert', name: 'Insert', type: 'string', screening: true }
  ],
  [ORDERING_DNA_FRAGMENTS_SERVICE_NAME]: [{ id: 'fragment-sequence', name: 'Fragment sequence', type: 'string', screening: true }],
  Pooling: [{ id: 'insert', name: 'Insert', type: 'string' }]
};

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
  nodes: Array<{ id: string; serviceName: string; formData: unknown; parameters?: any[] }>,
  overrides: Partial<{
    screenSequences: jest.Mock;
    setHomologyScreening: jest.Mock;
    setAclidScreening: jest.Mock;
    appendScreeningBatchId: jest.Mock;
    aclidConfigured: boolean;
    screenInline: jest.Mock;
    job: Partial<Job> | null;
    readObject: jest.Mock;
    screeningRuns: any;
  }> = {}
): {
  service: JobScreeningService;
  job: Job | null;
  setHomologyScreening: jest.Mock;
  setAclidScreening: jest.Mock;
  appendScreeningBatchId: jest.Mock;
  screenSequences: jest.Mock;
  screenInline: jest.Mock;
  files: any;
  screeningRuns: any;
  setAclidCustomerStatus: jest.Mock;
  createCustomer: jest.Mock;
  pollCustomer: jest.Mock;
  getCustomer: jest.Mock;
  workflowService: any;
} {
  const job = overrides.job === undefined ? ({ _id: 'job-1', workflows: [WORKFLOW_ID] } as unknown as Job) : (overrides.job as Job | null);

  const setHomologyScreening = overrides.setHomologyScreening ?? jest.fn(async () => job);
  const setAclidScreening = overrides.setAclidScreening ?? jest.fn(async () => job);
  const appendScreeningBatchId = overrides.appendScreeningBatchId ?? jest.fn(async () => job);
  const setAclidCustomerStatus = jest.fn(async () => undefined);
  const jobService: any = { findById: jest.fn(async () => job), setHomologyScreening, setAclidScreening, appendScreeningBatchId, setAclidCustomerStatus };

  const workflowService: any = {
    findByIds: jest.fn(async () => [{ _id: WORKFLOW_ID, nodes: nodes.map((n) => ({ _id: n.id })) }])
  };
  const workflowNodeService: any = {
    getByIDs: jest.fn(async () => nodes.map((n) => ({ _id: n.id, id: n.id, service: `svc-${n.id}`, formData: n.formData })))
  };
  const dampLabServices: any = {
    findOne: jest.fn(async (id: string) => {
      const node = nodes.find((n) => `svc-${n.id}` === id);
      return node ? { name: node.serviceName, parameters: node.parameters ?? PARAMETERS_BY_SERVICE[node.serviceName] ?? [] } : null;
    })
  };
  const screenSequences = overrides.screenSequences ?? jest.fn();
  const secureDnaService: any = { screenSequences };

  const screenInline = overrides.screenInline ?? jest.fn();
  const createCustomer = jest.fn<Promise<{ requesterId: string; status: string }>, [unknown]>(async () => ({ requesterId: 'req_1', status: 'queued' }));
  const pollCustomer = jest.fn<Promise<any>, [unknown]>(async () => customerRecord());
  const getCustomer = jest.fn();
  const aclidService: any = {
    isConfigured: () => overrides.aclidConfigured ?? false,
    screenInline,
    getScreen: jest.fn(),
    getScreenDetails: jest.fn(async (): Promise<Record<string, unknown> | null> => ({ [`${WORKFLOW_ID}_n1_insert`]: { matches: [], findings: null, regulatory_status: 'not_controlled' } })),
    createCustomer,
    pollCustomer,
    getCustomer
  };

  const files: any = {
    readObject:
      overrides.readObject ??
      jest.fn(async () => {
        throw new Error('Workflow parameter file storage is not configured on the server.');
      })
  };
  const screeningRuns: any = overrides.screeningRuns ?? {
    create: jest.fn(async () => 'run-1'),
    update: jest.fn(async () => undefined),
    findByAclidScreenId: jest.fn(async () => null),
    findNewestForJob: jest.fn(async () => null),
    updateCustomerLeg: jest.fn(async () => undefined),
    updateAclidLeg: jest.fn<Promise<void>, [string, Record<string, unknown>, Record<string, unknown>]>(async () => undefined)
  };

  const service = new JobScreeningService(jobService, workflowService, workflowNodeService, dampLabServices, secureDnaService, aclidService, files, screeningRuns);
  return {
    service,
    job,
    setHomologyScreening,
    setAclidScreening,
    appendScreeningBatchId,
    screenSequences,
    screenInline,
    files,
    screeningRuns,
    setAclidCustomerStatus,
    createCustomer,
    pollCustomer,
    getCustomer,
    workflowService
  };
}

/** A finished Aclid customer record (PASSED), with only the fields a test cares about overridden. */
function customerRecord(overrides: Partial<Record<string, unknown>> = {}): any {
  return { requesterId: 'req_1', status: 'PASSED', verdict: 'clear', decisionStatus: 'approved', checks: [], counts: { total: 0 }, raw: { requester_id: 'req_1' }, ...overrides };
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
    const { targets } = await service.collectScreeningTargets(job!);
    expect(targets).toEqual([{ name: `${WORKFLOW_ID}_n1_insert`, seq: DNA_A, label: 'Gibson Assembly › Insert' }]);
  });

  it('takes the ordered fragment when Gibson’s insert is only a description', async () => {
    const { service, job } = harness([
      {
        id: 'n1',
        serviceName: ORDERING_DNA_FRAGMENTS_SERVICE_NAME,
        formData: [{ id: 'fragment-sequence', value: DNA_A }]
      },
      {
        id: 'n2',
        serviceName: GIBSON_ASSEMBLY_SERVICE_NAME,
        formData: [{ id: 'insert', value: 'sfGFP (717 bp) with 25 bp homology arms' }]
      }
    ]);
    const { targets } = await service.collectScreeningTargets(job!);
    expect(targets).toEqual([{ name: `${WORKFLOW_ID}_n1_fragment-sequence`, seq: DNA_A, label: 'Ordering DNA Fragments from third-party › Fragment sequence' }]);
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
    const { targets } = await service.collectScreeningTargets(job!);
    expect(targets.map((t) => t.name)).toEqual([`${WORKFLOW_ID}_n1_vector`, `${WORKFLOW_ID}_n1_insert`]);
  });

  it('ignores a service whose parameters are not flagged, whatever its name (behaviour 1)', async () => {
    const { service, job } = harness([{ id: 'n1', serviceName: 'Pooling', formData: [{ id: 'insert', value: DNA_A }] }]);
    expect((await service.collectScreeningTargets(job!)).targets).toEqual([]);
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
    const { targets } = await service.collectScreeningTargets(job!);
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
    expect((await service.collectScreeningTargets(job!)).targets.length).toBe(3);
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
    // customerStatus comes from the customer leg, not from KYC (Approach 8).
    expect(aclid.customerStatus).toBe(HomologyScreeningStatus.UNAVAILABLE);
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

  it('in aclid mode records Passed from a succeeded screen with no regulatory status and does not call SecureDNA', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const screenInline = jest.fn(async () => aclidScreen({ status: 'succeeded', regulatoryStatus: null }));
    const screenSequences = jest.fn();
    const { service, setAclidScreening } = harness(gibson, { aclidConfigured: true, screenInline, screenSequences });

    const result = await service.screenJob('job-1', 'user-1');

    expect(screenSequences).not.toHaveBeenCalled();
    expect(result.status).toBe(HomologyScreeningStatus.PASSED);
    expect(result.batchId).toBeNull();
    expect(result.detail).toContain('Aclid passed');
    expect(lastCall(setAclidScreening).homologyStatus).toBe(HomologyScreeningStatus.PASSED);
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
    // customerStatus comes from the customer leg, not from KYC (Approach 8).
    expect(aclid.customerStatus).toBe(HomologyScreeningStatus.UNAVAILABLE);

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

describe('collectScreeningTargets from flags (biosecurity-update)', () => {
  const PLATE_KEY = 'workflow-parameters/user-1/abc-plate.csv';
  const plateValue = JSON.stringify({ filename: 'plate.csv', key: PLATE_KEY, sampleCount: 2, countedBy: 'server' });
  const plateParam = {
    id: 'plate',
    name: 'Plate map',
    type: 'table',
    screening: true,
    screeningFields: ['insert', 'Vector'],
    tableData: { columns: [{ header: 'Well' }, { header: 'Insert' }, { header: 'Vector' }] }
  };

  it('sends every non-empty cell of each screening column, row by row, with row and column in name and label (behaviour 2)', async () => {
    const readObject = jest.fn(async () => Buffer.from(`Well,INSERT,Vector\nA1,${DNA_A},${DNA_B}\nA2,,${DNA_A}\n`));
    const { service, job } = harness([{ id: 'n1', serviceName: 'Plates', parameters: [plateParam], formData: [{ id: 'plate', value: plateValue }] }], { readObject });
    const { targets, notes, skippedCount } = await service.collectScreeningTargets(job!);
    expect(readObject).toHaveBeenCalledWith(PLATE_KEY, 10 * 1024 * 1024);
    expect(targets).toEqual([
      { name: `${WORKFLOW_ID}_n1_plate_r1_insert`, seq: DNA_A, label: 'Plates › Plate map › row 1 › INSERT' },
      { name: `${WORKFLOW_ID}_n1_plate_r1_vector`, seq: DNA_B, label: 'Plates › Plate map › row 1 › Vector' },
      { name: `${WORKFLOW_ID}_n1_plate_r2_vector`, seq: DNA_A, label: 'Plates › Plate map › row 2 › Vector' }
    ]);
    expect(notes).toEqual([]);
    expect(skippedCount).toBe(0);
  });

  it('screens every column whose header matches a screening field, with distinct names (duplicate headers)', async () => {
    const param = { ...plateParam, screeningFields: ['Insert'], tableData: { columns: [{ header: 'Well' }, { header: 'Insert' }] } };
    const readObject = jest.fn(async () => Buffer.from(`Well,Insert,INSERT,Insert\nA1,${DNA_A},${DNA_B},${DNA_A}\n`));
    const { service, job } = harness([{ id: 'n1', serviceName: 'Plates', parameters: [param], formData: [{ id: 'plate', value: plateValue }] }], { readObject });
    const { targets } = await service.collectScreeningTargets(job!);
    expect(targets).toEqual([
      { name: `${WORKFLOW_ID}_n1_plate_r1_insert`, seq: DNA_A, label: 'Plates › Plate map › row 1 › Insert' },
      { name: `${WORKFLOW_ID}_n1_plate_r1_insert-2`, seq: DNA_B, label: 'Plates › Plate map › row 1 › INSERT' },
      { name: `${WORKFLOW_ID}_n1_plate_r1_insert-3`, seq: DNA_A, label: 'Plates › Plate map › row 1 › Insert' }
    ]);
  });

  it('reads a screening column whose header is named like an Object.prototype member', async () => {
    const param = { ...plateParam, screeningFields: ['constructor'] };
    const readObject = jest.fn(async () => Buffer.from(`Well,constructor\nA1,${DNA_A}\n`));
    const { service, job } = harness([{ id: 'n1', serviceName: 'Plates', parameters: [param], formData: [{ id: 'plate', value: plateValue }] }], { readObject });
    const { targets } = await service.collectScreeningTargets(job!);
    expect(targets.map((t) => t.seq)).toEqual([DNA_A]);
  });

  it('reports a screening column the file does not have, and still screens the rest (behaviour 2)', async () => {
    const readObject = jest.fn(async () => Buffer.from(`Well,Insert\nA1,${DNA_A}\n`));
    const { service, job } = harness([{ id: 'n1', serviceName: 'Plates', parameters: [plateParam], formData: [{ id: 'plate', value: plateValue }] }], { readObject });
    const { targets, notes } = await service.collectScreeningTargets(job!);
    expect(targets.map((t) => t.name)).toEqual([`${WORKFLOW_ID}_n1_plate_r1_insert`]);
    expect(notes).toEqual(['Plates › Plate map: plate.csv has no column “Vector”']);
  });

  it('never reads a key outside workflow-parameters/, and notes an unreadable file instead of failing', async () => {
    const readObject = jest.fn(async () => {
      throw new Error('Workflow parameter file storage is not configured on the server.');
    });
    const foreign = JSON.stringify({ filename: 'x.csv', key: 'sample-sheet-templates/x.csv' });
    const climbing = JSON.stringify({ filename: 'y.csv', key: 'workflow-parameters/../secrets.csv' });
    const { service, job } = harness(
      [
        { id: 'n1', serviceName: 'Plates', parameters: [plateParam], formData: [{ id: 'plate', value: foreign }] },
        { id: 'n2', serviceName: 'Plates', parameters: [plateParam], formData: [{ id: 'plate', value: climbing }] },
        { id: 'n3', serviceName: 'Plates', parameters: [plateParam], formData: [{ id: 'plate', value: plateValue }] }
      ],
      { readObject }
    );
    const { targets, notes } = await service.collectScreeningTargets(job!);
    expect(readObject).toHaveBeenCalledTimes(1);
    expect(targets).toEqual([]);
    expect(notes).toEqual([
      'Plates › Plate map: x.csv was not uploaded, so it was not screened',
      'Plates › Plate map: y.csv was not uploaded, so it was not screened',
      'Plates › Plate map: could not read plate.csv (Workflow parameter file storage is not configured on the server.)'
    ]);
  });

  it('screens every value of a multi-value Text, each under its own name (behaviour 1)', async () => {
    const params = [{ id: 'inserts', name: 'Inserts', type: 'string', allowMultipleValues: true, screening: true }];
    const { service, job } = harness([{ id: 'n1', serviceName: 'Cloning', parameters: params, formData: [{ id: 'inserts', value: [DNA_A, ' ', DNA_B] }] }]);
    const { targets } = await service.collectScreeningTargets(job!);
    expect(targets).toEqual([
      { name: `${WORKFLOW_ID}_n1_inserts_v1`, seq: DNA_A, label: 'Cloning › Inserts › value 1' },
      { name: `${WORKFLOW_ID}_n1_inserts_v2`, seq: DNA_B, label: 'Cloning › Inserts › value 2' }
    ]);
  });

  it('counts the values it did not send because they are not DNA (behaviour 3)', async () => {
    const readObject = jest.fn(async () => Buffer.from(`Insert,Vector\nTBD,${DNA_A}\nsee email,\n`));
    const { service, job } = harness(
      [
        {
          id: 'n1',
          serviceName: M_CLONING_SERVICE_NAME,
          formData: [
            { id: 'vector', value: 'will email this separately' },
            { id: 'insert', value: DNA_A }
          ]
        },
        { id: 'n2', serviceName: 'Plates', parameters: [plateParam], formData: [{ id: 'plate', value: plateValue }] }
      ],
      { readObject }
    );
    const { targets, skippedCount } = await service.collectScreeningTargets(job!);
    expect(targets.map((t) => t.name)).toEqual([`${WORKFLOW_ID}_n1_insert`, `${WORKFLOW_ID}_n2_plate_r1_vector`]);
    expect(skippedCount).toBe(3);
  });

  it('reads the flag from parameter-set parameters too — they arrive in the effective list', async () => {
    const params = [{ id: 'seq', name: 'Sequence', type: 'string', screening: true, fromParameterSetId: 'set1', fromParameterSetName: 'DNA' }];
    const { service, job } = harness([{ id: 'n1', serviceName: 'Anything', parameters: params, formData: [{ id: 'seq', value: DNA_A }] }]);
    expect((await service.collectScreeningTargets(job!)).targets.map((t) => t.name)).toEqual([`${WORKFLOW_ID}_n1_seq`]);
  });
});

describe('screening runs (biosecurity-update behaviour 6)', () => {
  const gibson = [{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_A }] }];
  const originalMode = process.env.BIOSECURITY_HOMOLOGY_MODE;
  afterEach(() => {
    if (originalMode === undefined) delete process.env.BIOSECURITY_HOMOLOGY_MODE;
    else process.env.BIOSECURITY_HOMOLOGY_MODE = originalMode;
  });
  const closing = (runs: any): any => runs.update.mock.calls[runs.update.mock.calls.length - 1][1];

  it('opens one run with the trigger, records the sequences, then closes it with the job row’s verdict', async () => {
    const screenSequences = jest.fn(async () => granted);
    const { service, screeningRuns, setHomologyScreening } = harness(gibson, { screenSequences });
    await service.screenJob('job-1', 'user-1', { trigger: ScreeningRunTrigger.RERUN, triggeredBy: 'staff@bu.edu' });

    expect(screeningRuns.create).toHaveBeenCalledTimes(1);
    expect(screeningRuns.create.mock.calls[0][0]).toMatchObject({ jobId: 'job-1', trigger: 'RERUN', triggeredBy: 'staff@bu.edu', status: 'IN_PROGRESS' });
    expect(screeningRuns.update.mock.calls[0][1]).toEqual({
      sequences: [{ name: `${WORKFLOW_ID}_n1_insert`, label: 'Gibson Assembly › Insert', length: DNA_A.length, aclidEligible: true }],
      sequenceCount: 1,
      skippedCount: 0
    });
    const closed = closing(screeningRuns);
    expect(closed.status).toBe(lastStatus(setHomologyScreening).status);
    expect(closed.completedAt).toBeInstanceOf(Date);
    expect(closed.secureDna).toEqual({ batchId: granted.id, status: 'PASSED', detail: null });
    expect(closed.aclid).toBeNull();
  });

  it('defaults to SUBMISSION with no one named', async () => {
    const { service, screeningRuns } = harness(gibson, { screenSequences: jest.fn(async () => granted) });
    await service.screenJob('job-1', 'user-1');
    expect(screeningRuns.create.mock.calls[0][0]).toMatchObject({ trigger: 'SUBMISSION', triggeredBy: null });
  });

  it('closes the run UNAVAILABLE with the skipped count when nothing is screenable (behaviours 3, 11)', async () => {
    const { service, screeningRuns } = harness([{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: 'TBD later' }] }]);
    const result = await service.screenJob('job-1', 'user-1');
    expect(result.detail).toBe('No screenable DNA sequences on this job');
    expect(screeningRuns.create).toHaveBeenCalledTimes(1);
    expect(screeningRuns.update.mock.calls[0][1]).toMatchObject({ sequenceCount: 0, skippedCount: 1 });
    expect(closing(screeningRuns)).toMatchObject({ status: 'UNAVAILABLE', detail: 'No screenable DNA sequences on this job; 1 value skipped: not DNA' });
  });

  it('tells the job a staff rerun with nothing to screen produced no screen (M9)', async () => {
    const nothing = [{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: 'TBD later' }] }];
    const rerun = harness(nothing, { aclidConfigured: true });
    await rerun.service.screenJob('job-1', 'user-1', { trigger: ScreeningRunTrigger.RERUN, triggeredBy: 'Staff' });
    expect(rerun.setAclidScreening.mock.calls.at(-1)?.[2]).toEqual({ rerun: true });

    // Any other path leaves the merge to keep the old screen id.
    const other = harness(nothing, { aclidConfigured: true });
    await other.service.screenJob('job-1', 'user-1');
    expect(other.setAclidScreening.mock.calls.at(-1)?.[2]).toBeUndefined();
  });

  it('a staff rerun where every sequence is too short for Aclid clears the old screen id (M9)', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const short = [{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_SHORT }] }];
    const h = harness(short, { aclidConfigured: true, screenInline: jest.fn() });
    await h.service.screenJob('job-1', 'user-1', { trigger: ScreeningRunTrigger.RERUN, triggeredBy: 'Staff' });
    expect(h.screenInline).not.toHaveBeenCalled();
    expect(h.setAclidScreening.mock.calls.at(-1)?.[2]).toEqual({ rerun: true });
  });

  it('a staff rerun where Aclid errors keeps the old screen id (M9)', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const screenInline = jest.fn(async () => {
      throw new Error('aclid down');
    });
    const h = harness(gibson, { aclidConfigured: true, screenInline });
    await h.service.screenJob('job-1', 'user-1', { trigger: ScreeningRunTrigger.RERUN, triggeredBy: 'Staff' });
    expect(screenInline).toHaveBeenCalled();
    expect(h.setAclidScreening.mock.calls.at(-1)?.[2]).toBeUndefined();
  });

  it('closes the run when collection itself fails', async () => {
    const { service, screeningRuns } = harness(gibson);
    jest.spyOn(service, 'collectScreeningTargets').mockRejectedValueOnce(new Error('mongo down'));
    await service.screenJob('job-1', 'user-1');
    expect(screeningRuns.create).toHaveBeenCalledTimes(1);
    expect(closing(screeningRuns)).toMatchObject({ status: 'UNAVAILABLE', detail: "Could not read the job's sequences: mongo down" });
  });

  it('writes no run for a job that does not exist', async () => {
    const { service, screeningRuns } = harness(gibson, { job: null });
    await service.screenJob('missing', 'user-1');
    expect(screeningRuns.create).not.toHaveBeenCalled();
  });

  it('a run that cannot be written never stops the screen or changes the job row', async () => {
    const screeningRuns = {
      create: jest.fn(async () => {
        throw new Error('write refused');
      }),
      update: jest.fn(),
      findByAclidScreenId: jest.fn(),
      updateAclidLeg: jest.fn()
    };
    const { service, setHomologyScreening } = harness(gibson, { screenSequences: jest.fn(async () => granted), screeningRuns });
    const result = await service.screenJob('job-1', 'user-1');
    expect(result.status).toBe(HomologyScreeningStatus.PASSED);
    expect(lastStatus(setHomologyScreening).status).toBe(HomologyScreeningStatus.PASSED);
    expect(screeningRuns.update).not.toHaveBeenCalled();
  });

  it('closes the run UNAVAILABLE and still rethrows when a job-row write rejects', async () => {
    const setHomologyScreening = jest.fn(async () => {
      throw new Error('mongo write failed');
    });
    const { service, screeningRuns } = harness(gibson, { screenSequences: jest.fn(async () => granted), setHomologyScreening });
    await expect(service.screenJob('job-1', 'user-1')).rejects.toThrow('mongo write failed');
    expect(screeningRuns.create).toHaveBeenCalledTimes(1);
    expect(closing(screeningRuns)).toMatchObject({ status: 'UNAVAILABLE', detail: 'mongo write failed' });
    expect(closing(screeningRuns).completedAt).toBeInstanceOf(Date);
  });

  it('stores the Aclid report and its per-sequence details once the screen succeeded (behaviour 13)', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const details = { [`${WORKFLOW_ID}_n1_insert`]: { matches: [], findings: null, regulatory_status: 'not_controlled' } };
    const screenInline = jest.fn(async () => aclidScreen({ matchCount: 3, materialCount: 0, materialSummary: {}, raw: { id: 'scr_1', status: 'succeeded' } }));
    const { service, screeningRuns } = harness(gibson, { aclidConfigured: true, screenInline });
    (service as any).aclidService.getScreenDetails = jest.fn(async () => details);
    await service.screenJob('job-1', 'user-1');
    expect(closing(screeningRuns).aclid).toEqual({
      screenId: 'scr_1',
      homologyStatus: 'PASSED',
      status: 'succeeded',
      regulatoryStatus: 'not_controlled',
      verificationStatus: 'pending',
      decisionStatus: null,
      matchCount: 3,
      materialCount: 0,
      findings: null,
      materialSummary: {},
      raw: { id: 'scr_1', status: 'succeeded' },
      details,
      detail: null
    });
  });

  it('keeps a controlled verdict and notes it when the details call fails (wave 3)', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const { service, screeningRuns, setAclidScreening } = harness(gibson, { aclidConfigured: true, screenInline: jest.fn(async () => aclidScreen({ regulatoryStatus: 'controlled' })) });
    (service as any).aclidService.getScreenDetails = jest.fn(async () => {
      throw new Error('Aclid returned 500');
    });
    await service.screenJob('job-1', 'user-1');
    expect(closing(screeningRuns).aclid).toMatchObject({ homologyStatus: 'FAILED', details: null, detail: 'Aclid details unavailable: Aclid returned 500' });
    expect(lastCall(setAclidScreening).homologyStatus).toBe(HomologyScreeningStatus.FAILED);
  });

  // The real screen from the human's test: succeeded, top-level regulatory_status null, every
  // sequence controlled in the details. One group's shape, sequence trimmed.
  const controlledDetails = {
    [`${WORKFLOW_ID}_n1_insert`]: {
      matches: [{ query: 'q', sseqid: 'AJ564621.1', regulatory_status: 'controlled', findings: { us_select_agent: { reason_code: 'virus', regulatory_status: 'controlled' } } }],
      findings: { us_select_agent: { reason_code: 'virus', regulatory_status: 'controlled' } },
      regulatory_status: 'controlled'
    }
  };

  it('fails the run, the Aclid leg and the job row when a sequence is controlled but the top level is empty (wave 3)', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const screenSequences = jest.fn(async () => granted);
    const { service, screeningRuns, setAclidScreening, setHomologyScreening } = harness(gibson, {
      aclidConfigured: true,
      screenInline: jest.fn(async () => aclidScreen({ regulatoryStatus: null })),
      screenSequences
    });
    (service as any).aclidService.getScreenDetails = jest.fn(async () => controlledDetails);
    await service.screenJob('job-1', 'user-1');
    expect(closing(screeningRuns).status).toBe('FAILED');
    expect(closing(screeningRuns).aclid).toMatchObject({ homologyStatus: 'FAILED', regulatoryStatus: 'controlled', details: controlledDetails });
    expect(lastCall(setAclidScreening)).toMatchObject({ homologyStatus: HomologyScreeningStatus.FAILED, regulatoryStatus: 'controlled' });
    expect(lastStatus(setHomologyScreening).status).toBe('FAILED');
    expect(screenSequences).not.toHaveBeenCalled();
  });

  it('passes when every sequence in the details is not_controlled (wave 3)', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const clear = { [`${WORKFLOW_ID}_n1_insert`]: { matches: [], findings: null, regulatory_status: 'not_controlled' } };
    const { service, screeningRuns } = harness(gibson, { aclidConfigured: true, screenInline: jest.fn(async () => aclidScreen({ regulatoryStatus: null })) });
    (service as any).aclidService.getScreenDetails = jest.fn(async () => clear);
    await service.screenJob('job-1', 'user-1');
    expect(closing(screeningRuns).status).toBe('PASSED');
    expect(closing(screeningRuns).aclid).toMatchObject({ homologyStatus: 'PASSED', details: clear });
  });

  it.each([
    ['a 204 (no details yet)', async (): Promise<null> => null],
    [
      'an error',
      async (): Promise<never> => {
        throw new Error('Aclid returned 500');
      }
    ]
  ])('does not pass a succeeded screen with an empty top level when its details come back as %s (wave 3)', async (_label, getDetails) => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const { service, screeningRuns, setAclidScreening, setHomologyScreening } = harness(gibson, {
      aclidConfigured: true,
      screenInline: jest.fn(async () => aclidScreen({ regulatoryStatus: null })),
      screenSequences: jest.fn(async () => ({ ...granted, synthesisPermission: 'denied' }))
    });
    (service as any).aclidService.getScreenDetails = jest.fn(getDetails);
    await service.screenJob('job-1', 'user-1');
    expect(closing(screeningRuns).aclid).toMatchObject({ screenId: 'scr_1', homologyStatus: 'IN_PROGRESS', details: null, detail: expect.stringContaining('could not be read') });
    expect(lastCall(setAclidScreening)).toMatchObject({ homologyStatus: HomologyScreeningStatus.IN_PROGRESS, screenId: 'scr_1' });
    expect(closing(screeningRuns).status).not.toBe('PASSED');
    expect(lastStatus(setHomologyScreening).status).not.toBe('PASSED');
  });

  it.each<[string, string, () => Promise<Record<string, unknown> | null>]>([
    ['aclid', 'a 204', async (): Promise<null> => null],
    ['aclid', 'an empty body', async (): Promise<Record<string, unknown>> => ({})],
    ['aclid', 'a group with a null status', async (): Promise<Record<string, unknown>> => ({ g: { matches: [], regulatory_status: null } })],
    [
      'aclid',
      'an error',
      async (): Promise<never> => {
        throw new Error('Aclid timed out');
      }
    ],
    [
      'both',
      'a thrown call',
      async (): Promise<never> => {
        throw new Error('Aclid timed out');
      }
    ]
  ])('%s mode: an unread Aclid answer (%s) is not cleared by a granting SecureDNA (wave 4)', async (mode, _label, getDetails) => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = mode;
    const screenSequences = jest.fn(async () => granted);
    const { service, screeningRuns, setAclidScreening, setHomologyScreening } = harness(gibson, {
      aclidConfigured: true,
      screenInline: jest.fn(async () => aclidScreen({ regulatoryStatus: null })),
      screenSequences
    });
    (service as any).aclidService.getScreenDetails = jest.fn(getDetails);
    await service.screenJob('job-1', 'user-1');
    expect(closing(screeningRuns).status).not.toBe('PASSED');
    expect(lastStatus(setHomologyScreening).status).not.toBe('PASSED');
    expect(closing(screeningRuns).aclid).toMatchObject({ homologyStatus: 'IN_PROGRESS', detail: expect.stringContaining('could not be read') });
    expect(lastCall(setAclidScreening)).toMatchObject({ homologyStatus: HomologyScreeningStatus.IN_PROGRESS });
    const finished = { ...(closing(screeningRuns) as any), completedAt: new Date(), fingerprint: 'fp' };
    expect(decideAcceptanceScreening({ jobState: JobState.SUBMITTED, newestRun: finished, currentFingerprint: 'fp', callerCanScreen: true } as any).state).not.toBe('CLEAR');
    if (mode === 'aclid') expect(screenSequences).not.toHaveBeenCalled();
    else expect(screenSequences).toHaveBeenCalled();
  });

  it('records a pending Aclid screen on the run so a refresh can finish it', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const pending = aclidScreen({ id: 'scr_p', status: 'running', regulatoryStatus: null, raw: { id: 'scr_p' } }) as any;
    const screenInline = jest.fn(async () => {
      throw new AclidScreenPendingError(pending, 'did not finish');
    });
    const { service, screeningRuns } = harness(gibson, { aclidConfigured: true, screenInline, screenSequences: jest.fn(async () => granted) });
    await service.screenJob('job-1', 'user-1');
    expect(closing(screeningRuns).aclid).toMatchObject({ screenId: 'scr_p', homologyStatus: 'IN_PROGRESS', status: 'running', detail: 'Aclid screen still running' });
    expect(closing(screeningRuns).secureDna).toMatchObject({ status: 'PASSED' });
  });
});

describe('recordAclidRefresh (biosecurity-update behaviour 6, 13)', () => {
  const run = (aclid: any): Record<string, unknown> => ({ _id: 'run-1', status: 'UNAVAILABLE', aclid });

  it('updates the run carrying the screen, fetching details once it succeeded', async () => {
    const details = { a: { matches: [], findings: null, regulatory_status: 'controlled' } };
    const screeningRuns = {
      create: jest.fn(),
      update: jest.fn(),
      findByAclidScreenId: jest.fn(async () => run({ screenId: 'scr_1', details: null })),
      updateAclidLeg: jest.fn<Promise<void>, [string, Record<string, unknown>, Record<string, unknown>]>(async () => undefined)
    };
    const { service } = harness([], { screeningRuns });
    (service as any).aclidService.getScreenDetails = jest.fn(async () => details);
    await service.recordAclidRefresh(aclidScreen({ regulatoryStatus: 'controlled', raw: { id: 'scr_1' } }) as any);
    expect(screeningRuns.findByAclidScreenId).toHaveBeenCalledWith('scr_1');
    const [id, leg, patch] = screeningRuns.updateAclidLeg.mock.calls[0];
    expect(id).toBe('run-1');
    expect(leg).toMatchObject({ homologyStatus: 'FAILED', regulatoryStatus: 'controlled', status: 'succeeded', detail: null, raw: { id: 'scr_1' } });
    expect(leg).not.toHaveProperty('details');
    expect(patch).toMatchObject({ status: 'FAILED' });
    await new Promise(setImmediate);
    expect(screeningRuns.updateAclidLeg).toHaveBeenCalledTimes(2);
    expect(screeningRuns.updateAclidLeg.mock.calls[1][1]).toMatchObject({ details });
    expect(screeningRuns.create).not.toHaveBeenCalled();
  });

  it('does not fetch details again when the run already has them, and leaves the run status unless it now fails', async () => {
    const screeningRuns = {
      create: jest.fn(),
      update: jest.fn(),
      findByAclidScreenId: jest.fn(async () => run({ screenId: 'scr_1', details: { a: { matches: [], findings: null, regulatory_status: 'not_controlled' } } })),
      updateAclidLeg: jest.fn<Promise<void>, [string, Record<string, unknown>, Record<string, unknown>]>(async () => undefined)
    };
    const { service } = harness([], { screeningRuns });
    const getScreenDetails = jest.fn();
    (service as any).aclidService.getScreenDetails = getScreenDetails;
    await service.recordAclidRefresh(aclidScreen() as any);
    expect(getScreenDetails).not.toHaveBeenCalled();
    expect(screeningRuns.updateAclidLeg.mock.calls[0][1]).not.toHaveProperty('details');
    expect(screeningRuns.updateAclidLeg.mock.calls[0][2]).toEqual({});
  });

  it("keeps the run's Aclid leg IN_PROGRESS while the screen is still running", async () => {
    const screeningRuns = {
      create: jest.fn(),
      update: jest.fn(),
      findByAclidScreenId: jest.fn(async () => run({ screenId: 'scr_1', details: null })),
      updateAclidLeg: jest.fn<Promise<void>, [string, Record<string, unknown>, Record<string, unknown>]>(async () => undefined)
    };
    const { service } = harness([], { screeningRuns });
    await service.recordAclidRefresh(aclidScreen({ status: 'running', regulatoryStatus: null }) as any);
    expect(screeningRuns.updateAclidLeg.mock.calls[0][1]).toMatchObject({ homologyStatus: 'IN_PROGRESS', status: 'running', detail: 'Aclid screen still running' });
  });

  it('is a no-op for a screen no run carries (jobs screened before this change)', async () => {
    const screeningRuns = { create: jest.fn(), update: jest.fn(), findByAclidScreenId: jest.fn(async () => null), updateAclidLeg: jest.fn() };
    const { service } = harness([], { screeningRuns });
    await service.recordAclidRefresh(aclidScreen() as any);
    expect(screeningRuns.updateAclidLeg).not.toHaveBeenCalled();
  });

  describe('the verdict is taken with the details (wave 3)', () => {
    const controlled = { seq_a: { matches: [{ regulatory_status: 'controlled' }], regulatory_status: 'controlled' } };
    const setup = (aclid: Record<string, unknown>, getDetails: () => Promise<unknown>): any => {
      const screeningRuns = {
        create: jest.fn(),
        update: jest.fn(),
        findByAclidScreenId: jest.fn(async () => ({ _id: 'run-1', status: 'UNAVAILABLE', aclid: { screenId: 'scr_1', homologyStatus: 'IN_PROGRESS', details: null, ...aclid } })),
        updateAclidLeg: jest.fn<Promise<void>, [string, Record<string, unknown>, Record<string, unknown>]>(async () => undefined)
      };
      const { service } = harness([], { screeningRuns, aclidConfigured: true });
      (service as any).aclidService.getScreenDetails = jest.fn(getDetails);
      return { service, screeningRuns };
    };

    it('fails the run when the details hold a controlled sequence and the top level is empty, writing the details with it', async () => {
      const { service, screeningRuns } = setup({}, async () => controlled);
      await service.recordAclidRefresh(aclidScreen({ regulatoryStatus: null }) as any);
      const [, leg, patch] = screeningRuns.updateAclidLeg.mock.calls[0];
      expect(leg).toMatchObject({ homologyStatus: 'FAILED', regulatoryStatus: 'controlled', details: controlled });
      expect(patch).toEqual({ status: 'FAILED' });
      expect(screeningRuns.updateAclidLeg).toHaveBeenCalledTimes(1);
    });

    it('lifts a waiting run only when the details were read and are clear', async () => {
      const { service, screeningRuns } = setup({}, async () => ({ seq_a: { regulatory_status: 'not_controlled' } }));
      await service.recordAclidRefresh(aclidScreen({ regulatoryStatus: null }) as any);
      expect(screeningRuns.updateAclidLeg.mock.calls[0][2]).toEqual({ status: 'PASSED' });
    });

    it('stores details only once they are read: an unread body is replaced by a later controlled one (W4-m2)', async () => {
      const stored: Record<string, any> = { _id: 'run-1', status: 'UNAVAILABLE', aclid: { screenId: 'scr_1', homologyStatus: 'IN_PROGRESS', details: null } };
      const screeningRuns = {
        create: jest.fn(),
        update: jest.fn(),
        findByAclidScreenId: jest.fn(async () => stored),
        updateAclidLeg: jest.fn(async (_id: string, leg: Record<string, unknown>, patch: Record<string, unknown>) => {
          stored.aclid = { ...stored.aclid, ...leg };
          Object.assign(stored, patch);
        })
      };
      const { service } = harness([], { screeningRuns, aclidConfigured: true });
      let body: unknown = {};
      (service as any).aclidService.getScreenDetails = jest.fn(async () => body);
      await service.recordAclidRefresh(aclidScreen({ regulatoryStatus: null }) as any);
      expect(stored.aclid.details ?? null).toBeNull();
      expect(stored.status).toBe('UNAVAILABLE');
      body = controlled;
      await service.recordAclidRefresh(aclidScreen({ regulatoryStatus: null }) as any);
      expect(stored.aclid.details).toEqual(controlled);
      expect(stored.status).toBe('FAILED');
    });

    it('does not trust stored unread details: a refresh without a verdict fetches again (W4-m2)', async () => {
      const { service, screeningRuns } = setup({ details: {} }, async () => controlled);
      await service.recordAclidRefresh(aclidScreen({ regulatoryStatus: null }) as any);
      expect(screeningRuns.updateAclidLeg.mock.calls[0][1]).toMatchObject({ homologyStatus: 'FAILED', details: controlled });
    });

    it('keeps the leg waiting, with a detail, and never passes when the details come back empty (204)', async () => {
      const { service, screeningRuns } = setup({}, async () => null);
      await service.recordAclidRefresh(aclidScreen({ regulatoryStatus: null }) as any);
      const [, leg, patch] = screeningRuns.updateAclidLeg.mock.calls[0];
      expect(leg).toMatchObject({ homologyStatus: 'IN_PROGRESS', detail: expect.stringContaining('could not be read') });
      expect(patch).toEqual({});
    });
  });

  describe('lifting a slow screen', () => {
    const originalMode = process.env.BIOSECURITY_HOMOLOGY_MODE;
    afterEach(() => {
      if (originalMode === undefined) delete process.env.BIOSECURITY_HOMOLOGY_MODE;
      else process.env.BIOSECURITY_HOMOLOGY_MODE = originalMode;
    });
    const pendingRun = (extra: Record<string, unknown> = {}, aclid: Record<string, unknown> = {}): any => ({
      _id: 'run-1',
      status: 'UNAVAILABLE',
      aclid: { screenId: 'scr_1', homologyStatus: 'IN_PROGRESS', details: null, ...aclid },
      ...extra
    });
    const firstPatch = async (found: any, configured = true): Promise<any> => {
      const screeningRuns = {
        create: jest.fn(),
        update: jest.fn(),
        findByAclidScreenId: jest.fn(async () => found),
        updateAclidLeg: jest.fn<Promise<void>, [string, Record<string, unknown>, Record<string, unknown>]>(async () => undefined)
      };
      const { service } = harness([], { screeningRuns, aclidConfigured: configured });
      await service.recordAclidRefresh(aclidScreen() as any);
      return screeningRuns.updateAclidLeg.mock.calls[0][2];
    };

    it('a slow screen that now passes reaches PASSED', async () => {
      expect(await firstPatch(pendingRun())).toEqual({ status: 'PASSED' });
    });
    it('not when the SecureDNA leg failed', async () => {
      expect(await firstPatch(pendingRun({ secureDna: { status: 'FAILED' } }))).toEqual({});
    });
    it('not in securedna mode', async () => {
      process.env.BIOSECURITY_HOMOLOGY_MODE = 'securedna';
      expect(await firstPatch(pendingRun(), true)).toEqual({});
    });
    it('not when the Aclid leg already had an answer', async () => {
      expect(await firstPatch(pendingRun({}, { homologyStatus: 'UNAVAILABLE' }))).toEqual({});
    });
    it('a passing screen never lifts a FAILED run', async () => {
      expect(await firstPatch(pendingRun({ status: 'FAILED' }))).toEqual({});
    });
    it('a controlled screen resolves without waiting for the details call', async () => {
      const screeningRuns = {
        create: jest.fn(),
        update: jest.fn(),
        findByAclidScreenId: jest.fn(async () => pendingRun()),
        updateAclidLeg: jest.fn<Promise<void>, [string, Record<string, unknown>, Record<string, unknown>]>(async () => undefined)
      };
      const { service } = harness([], { screeningRuns });
      (service as any).aclidService.getScreenDetails = jest.fn(() => new Promise(() => undefined));
      const result = await Promise.race([
        service.recordAclidRefresh(aclidScreen({ regulatoryStatus: 'controlled' }) as any).then(() => 'done'),
        new Promise((resolve) => setTimeout(() => resolve('timed out'), 200))
      ]);
      expect(result).toBe('done');
      expect(screeningRuns.updateAclidLeg).toHaveBeenCalledTimes(1);
    });
  });
});

describe('refreshCustomerLeg (aclid-customer-screening)', () => {
  const leg = (status: string, extra: Record<string, unknown> = {}): any => ({ _id: 'run-1', customer: { status, requesterId: 'req_1', ...extra } });
  const setup = (newest: unknown): ReturnType<typeof harness> => {
    const h = harness([]);
    h.screeningRuns.findNewestForJob.mockImplementation(async () => newest);
    return h;
  };

  it("re-reads the newest run's leg and writes all of it", async () => {
    const h = setup(leg('NEEDS_REVIEW'));
    h.getCustomer.mockResolvedValue(customerRecord());
    await expect(h.service.refreshCustomerLeg('job-1')).resolves.toBe('PASSED');
    expect(h.getCustomer).toHaveBeenCalledWith('req_1');
    expect(h.screeningRuns.updateCustomerLeg).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'PASSED',
        verdict: expect.anything(),
        decisionStatus: expect.anything(),
        checks: expect.anything(),
        counts: expect.anything(),
        raw: expect.anything(),
        detail: null
      })
    );
    expect(h.createCustomer).not.toHaveBeenCalled();
  });

  it('NEEDS_REVIEW stores as IN_PROGRESS on the job', async () => {
    const h = setup(leg('IN_PROGRESS'));
    h.getCustomer.mockResolvedValue(customerRecord({ status: 'NEEDS_REVIEW' }));
    await expect(h.service.refreshCustomerLeg('job-1')).resolves.toBe('IN_PROGRESS');
  });

  it('an API error keeps the blocking status and writes only detail', async () => {
    const h = setup(leg('NEEDS_REVIEW'));
    h.getCustomer.mockRejectedValue(new Error('boom'));
    await expect(h.service.refreshCustomerLeg('job-1')).resolves.toBe('IN_PROGRESS');
    expect(h.screeningRuns.updateCustomerLeg).toHaveBeenCalledWith('run-1', { detail: 'boom' });
  });

  it('a not-enabled 403 on refresh does not unblock', async () => {
    const h = setup(leg('NEEDS_REVIEW'));
    h.getCustomer.mockRejectedValue(new AclidFeatureNotEnabledError('sanctions is not enabled for your organization'));
    await expect(h.service.refreshCustomerLeg('job-1')).resolves.toBe('IN_PROGRESS');
    for (const call of h.screeningRuns.updateCustomerLeg.mock.calls) expect(call[1]).not.toHaveProperty('status');
  });

  it('a leg with no requester id is not read', async () => {
    const h = setup({ _id: 'run-1', customer: { status: 'NOT_RUN', requesterId: null } });
    await expect(h.service.refreshCustomerLeg('job-1')).resolves.toBe('UNAVAILABLE');
    expect(h.getCustomer).not.toHaveBeenCalled();
  });

  it('no run, or a run with no leg, reads UNAVAILABLE', async () => {
    const h = setup(null);
    await expect(h.service.refreshCustomerLeg('job-1')).resolves.toBe('UNAVAILABLE');
    h.screeningRuns.findNewestForJob.mockImplementation(async () => ({ _id: 'run-1', customer: null }));
    await expect(h.service.refreshCustomerLeg('job-1')).resolves.toBe('UNAVAILABLE');
    expect(h.screeningRuns.updateCustomerLeg).not.toHaveBeenCalled();
    expect(h.getCustomer).not.toHaveBeenCalled();
  });

  it('a storage error resolves UNAVAILABLE', async () => {
    const h = harness([]);
    h.screeningRuns.findNewestForJob.mockRejectedValue(new Error('mongo down'));
    await expect(h.service.refreshCustomerLeg('job-1')).resolves.toBe('UNAVAILABLE');
  });
});

describe('screeningFingerprint', () => {
  const insertNode = (formData: unknown[], parameters?: any[]): Array<{ id: string; serviceName: string; formData: unknown; parameters?: any[] }> => [
    { id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, parameters, formData }
  ];

  it('is the same for the same flagged values, whatever unflagged parameters hold', async () => {
    const a = harness(
      insertNode([
        { id: 'insert', value: DNA_A },
        { id: 'vector', value: DNA_B }
      ])
    );
    const b = harness(
      insertNode([
        { id: 'insert', value: DNA_A },
        { id: 'vector', value: 'something else' }
      ])
    );
    expect(await a.service.screeningFingerprint(a.job!)).toBe(await b.service.screeningFingerprint(b.job!));
  });

  it('changes when a flagged value changes', async () => {
    const a = harness(insertNode([{ id: 'insert', value: DNA_A }]));
    const b = harness(insertNode([{ id: 'insert', value: DNA_B }]));
    expect(await a.service.screeningFingerprint(a.job!)).not.toBe(await b.service.screeningFingerprint(b.job!));
  });

  it('changes when another parameter with a value is flagged (behaviour 11)', async () => {
    const formData = [
      { id: 'insert', value: DNA_A },
      { id: 'vector', value: DNA_B }
    ];
    const before = harness(insertNode(formData));
    const flagged = harness(
      insertNode(formData, [
        { id: 'insert', name: 'Insert', type: 'string', screening: true },
        { id: 'vector', name: 'Vector', type: 'string', screening: true }
      ])
    );
    expect(await before.service.screeningFingerprint(before.job!)).not.toBe(await flagged.service.screeningFingerprint(flagged.job!));
  });

  describe('screening columns of a flagged Table (I1)', () => {
    const value = JSON.stringify({ filename: 'plate.csv', key: 'workflow-parameters/user-1/abc-plate.csv' });
    const withFields = (screeningFields: string[]): ReturnType<typeof harness> =>
      harness([{ id: 'n1', serviceName: 'Plates', parameters: [{ id: 'plate', name: 'Plate map', type: 'table', screening: true, screeningFields }], formData: [{ id: 'plate', value }] }]);

    it('changes when a screening column is added or removed', async () => {
      const one = withFields(['insert']);
      const two = withFields(['insert', 'vector']);
      const none = withFields([]);
      const base = await one.service.screeningFingerprint(one.job!);
      expect(await two.service.screeningFingerprint(two.job!)).not.toBe(base);
      expect(await none.service.screeningFingerprint(none.job!)).not.toBe(base);
    });

    it('does not change when the same columns are reordered', async () => {
      const a = withFields(['insert', 'vector']);
      const b = withFields(['vector', 'insert']);
      expect(await a.service.screeningFingerprint(a.job!)).toBe(await b.service.screeningFingerprint(b.job!));
    });
  });

  it('does not change when a flagged parameter has no value', async () => {
    const formData = [{ id: 'insert', value: DNA_A }];
    const before = harness(insertNode(formData));
    const flagged = harness(
      insertNode(formData, [
        { id: 'insert', name: 'Insert', type: 'string', screening: true },
        { id: 'vector', name: 'Vector', type: 'string', screening: true }
      ])
    );
    expect(await before.service.screeningFingerprint(before.job!)).toBe(await flagged.service.screeningFingerprint(flagged.job!));
  });

  it('never reads S3 for a flagged table', async () => {
    const readObject = jest.fn();
    const param = { id: 'plate', name: 'Plate map', type: 'table', screening: true, screeningFields: ['insert'] };
    const value = JSON.stringify({ filename: 'plate.csv', key: 'workflow-parameters/user-1/abc-plate.csv' });
    const { service, job } = harness([{ id: 'n1', serviceName: 'Plates', parameters: [param], formData: [{ id: 'plate', value }] }], { readObject });
    await expect(service.screeningFingerprint(job!)).resolves.toMatch(/^[0-9a-f]{64}$/);
    expect(readObject).not.toHaveBeenCalled();
  });
});

describe('customer leg (aclid-customer-screening)', () => {
  const gibson = [{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_A }] }];
  const rerun = { trigger: ScreeningRunTrigger.RERUN, triggeredBy: 'Staff' };
  const originalMode = process.env.BIOSECURITY_HOMOLOGY_MODE;
  const person = { clientDisplayName: 'Ada', institute: 'BU', email: 'a@bu.edu' };
  const withPerson = { job: { _id: 'job-1', workflows: [WORKFLOW_ID], ...person } as unknown as Partial<Job> };
  const passingScreen = (): jest.Mock => jest.fn(async () => aclidScreen());

  afterEach(() => {
    if (originalMode === undefined) delete process.env.BIOSECURITY_HOMOLOGY_MODE;
    else process.env.BIOSECURITY_HOMOLOGY_MODE = originalMode;
  });

  /** The patch of the last `update` call. */
  const closed = (screeningRuns: any): any => screeningRuns.update.mock.calls[screeningRuns.update.mock.calls.length - 1][1];

  it('AUTO_SCREENING_ENABLED is off: screenJobInBackground creates no run', async () => {
    const { service, screeningRuns } = harness(gibson);
    service.screenJobInBackground('job-1', 'user-1');
    await new Promise((resolve) => setImmediate(resolve));
    expect(AUTO_SCREENING_ENABLED).toBe(false);
    expect(screeningRuns.create).not.toHaveBeenCalled();
  });

  it("a rerun posts the customer with the run's screen id, after homology", async () => {
    const order: string[] = [];
    const screenInline = jest.fn(async () => {
      order.push('screenInline');
      return aclidScreen();
    });
    const h = harness(gibson, { aclidConfigured: true, screenInline, ...withPerson });
    h.createCustomer.mockImplementation(async () => {
      order.push('createCustomer');
      return { requesterId: 'req_1', status: 'queued' };
    });

    await h.service.screenJob('job-1', 'user-1', rerun);

    expect(h.createCustomer).toHaveBeenCalledWith({ name: 'Ada', company: 'BU', email: 'a@bu.edu', screenId: 'scr_1' });
    expect(h.pollCustomer).toHaveBeenCalledWith('req_1');
    expect(order).toEqual(['screenInline', 'createCustomer']);
    expect(closed(h.screeningRuns).customer).toMatchObject({ status: 'PASSED', requesterId: 'req_1' });
  });

  it('runs the leg even when homology failed', async () => {
    const screenInline = jest.fn(async () => aclidScreen({ regulatoryStatus: 'controlled' }));
    const h = harness(gibson, { aclidConfigured: true, screenInline, ...withPerson });
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(h.createCustomer).toHaveBeenCalled();
    expect(closed(h.screeningRuns).status).toBe('FAILED');
  });

  it("a still-running screen's id is used", async () => {
    const screenInline = jest.fn(async () => {
      throw new AclidScreenPendingError(aclidScreen({ id: 'scr_pending', status: 'running' }) as any, 'still running');
    });
    const h = harness(gibson, { aclidConfigured: true, screenInline, screenSequences: jest.fn(async () => granted), ...withPerson });
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(h.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ screenId: 'scr_pending' }));
  });

  const notRun = { status: 'NOT_RUN', requesterId: null, verdict: null, decisionStatus: null, checks: null, counts: null, raw: null, detail: null };

  it('no screen id: NOT_RUN and no customer call', async () => {
    const screenInline = jest.fn(async () => {
      throw new Error('boom');
    });
    const h = harness(gibson, { aclidConfigured: true, screenInline, screenSequences: jest.fn(async () => granted), ...withPerson });
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(closed(h.screeningRuns).customer).toEqual(notRun);
  });

  it('Aclid not configured: NOT_RUN', async () => {
    const h = harness(gibson, { aclidConfigured: false, screenSequences: jest.fn(async () => granted), ...withPerson });
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(closed(h.screeningRuns).customer).toEqual(notRun);
  });

  it('zero sequences: NOT_RUN on a rerun', async () => {
    const h = harness([{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: 'TBD later' }] }], {
      aclidConfigured: true,
      screenInline: passingScreen(),
      ...withPerson
    });
    await h.service.screenJob('job-1', 'user-1', rerun);
    const patch = closed(h.screeningRuns);
    expect(patch.customer.status).toBe('NOT_RUN');
    expect(patch.status).toBe('UNAVAILABLE');
    expect(patch.sequenceCount).toBe(0);
  });

  it('feature not enabled gives NOT_AVAILABLE (behaviour 3)', async () => {
    const h = harness(gibson, { aclidConfigured: true, screenInline: passingScreen(), ...withPerson });
    h.createCustomer.mockRejectedValue(new AclidFeatureNotEnabledError('Feature "sanctions" is not enabled for your organization'));
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(closed(h.screeningRuns).customer).toMatchObject({ status: 'NOT_AVAILABLE', detail: 'Customer screening is not enabled for this Aclid account' });
    expect(h.pollCustomer).not.toHaveBeenCalled();
  });

  it('not enabled on the read also gives NOT_AVAILABLE, keeping the id', async () => {
    const h = harness(gibson, { aclidConfigured: true, screenInline: passingScreen(), ...withPerson });
    h.pollCustomer.mockRejectedValue(new AclidFeatureNotEnabledError('Feature "sanctions" is not enabled for your organization'));
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(closed(h.screeningRuns).customer).toMatchObject({ status: 'NOT_AVAILABLE', requesterId: 'req_1' });
  });

  it('any other error gives UNAVAILABLE with the reason, keeping the id', async () => {
    const h = harness(gibson, { aclidConfigured: true, screenInline: passingScreen(), ...withPerson });
    h.pollCustomer.mockRejectedValue(new Error('boom'));
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(closed(h.screeningRuns).customer).toMatchObject({ status: 'UNAVAILABLE', detail: 'boom', requesterId: 'req_1' });
  });

  it('a post failure gives UNAVAILABLE with no id', async () => {
    const h = harness(gibson, { aclidConfigured: true, screenInline: passingScreen(), ...withPerson });
    h.createCustomer.mockRejectedValue(new Error('boom'));
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(closed(h.screeningRuns).customer).toMatchObject({ status: 'UNAVAILABLE', detail: 'boom', requesterId: null });
  });

  it('out of budget records IN_PROGRESS and keeps the id (behaviour 5)', async () => {
    const h = harness(gibson, { aclidConfigured: true, screenInline: passingScreen(), ...withPerson });
    h.pollCustomer.mockRejectedValue(new AclidCustomerPendingError(customerRecord({ status: CustomerScreeningStatus.IN_PROGRESS, verdict: 'needs_review' }) as any));
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(closed(h.screeningRuns).customer).toMatchObject({ status: 'IN_PROGRESS', requesterId: 'req_1', verdict: 'needs_review' });
  });

  it('a customer-triggered screen never posts a customer', async () => {
    const h = harness(gibson, { aclidConfigured: true, screenInline: passingScreen(), ...withPerson });
    await h.service.screenJob('job-1', 'sub');
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(closed(h.screeningRuns).customer ?? null).toBeNull();
    expect(h.setAclidCustomerStatus).not.toHaveBeenCalled();
  });

  it('the run completes after the customer leg', async () => {
    const order: string[] = [];
    const h = harness(gibson, { aclidConfigured: true, screenInline: passingScreen(), ...withPerson });
    h.pollCustomer.mockImplementation(async () => {
      order.push('pollCustomer');
      return customerRecord();
    });
    h.screeningRuns.update.mockImplementation(async (_id: string, patch: any) => {
      order.push(patch.completedAt ? 'closed' : 'update');
    });
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(order).toContain('pollCustomer');
    expect(order.indexOf('pollCustomer')).toBeLessThan(order.indexOf('closed'));
    expect(order.filter((o) => o === 'closed')).toHaveLength(1);
    expect(order[order.length - 1]).toBe('closed');
  });

  it("writes the job's customerStatus from the leg", async () => {
    const h = harness(gibson, { aclidConfigured: true, screenInline: passingScreen(), ...withPerson });
    h.pollCustomer.mockResolvedValue(customerRecord({ status: CustomerScreeningStatus.NEEDS_REVIEW, verdict: 'needs_review' }));
    await h.service.screenJob('job-1', 'user-1', rerun);
    expect(h.setAclidCustomerStatus).toHaveBeenCalledWith('job-1', 'IN_PROGRESS');
  });

  it('stores the fingerprint when the run opens', async () => {
    const h = harness(gibson, { screenSequences: jest.fn(async () => granted) });
    await h.service.screenJob('job-1', 'user-1');
    expect(h.screeningRuns.create.mock.calls[0][0].fingerprint).toBe(await h.service.screeningFingerprint(h.job!));
  });

  it('a value edited while the run is in flight leaves the opening fingerprint', async () => {
    const nodes = [{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_A }] as unknown }];
    const screenInline = jest.fn(async () => {
      nodes[0].formData = [{ id: 'insert', value: DNA_B }];
      return aclidScreen();
    });
    const h = harness(nodes, { aclidConfigured: true, screenInline });
    await h.service.screenJob('job-1', 'user-1');
    const stored = h.screeningRuns.create.mock.calls[0][0].fingerprint;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe(await h.service.screeningFingerprint(h.job!));
  });

  it('a fingerprint that cannot be read stores null and still screens', async () => {
    const h = harness(gibson, { screenSequences: jest.fn(async () => granted) });
    const original = h.workflowService.findByIds.getMockImplementation();
    h.workflowService.findByIds.mockRejectedValueOnce(new Error('mongo down'));
    h.workflowService.findByIds.mockImplementation(original);
    await h.service.screenJob('job-1', 'user-1');
    expect(h.screeningRuns.create.mock.calls[0][0].fingerprint).toBeNull();
    expect(closed(h.screeningRuns).completedAt).toBeInstanceOf(Date);
    expect(closed(h.screeningRuns).status).toBe('PASSED');
  });

  it('table notes go in unscreenedNotes (behaviour 9)', async () => {
    const plate = { id: 'plate', name: 'Plate map', type: 'table', screening: true, screeningFields: ['Insert'] };
    const h = harness(
      [
        { id: 'n1', serviceName: 'Plates', parameters: [plate], formData: [{ id: 'plate', value: JSON.stringify({ filename: 'plate.csv' }) }] },
        { id: 'n2', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_A }] }
      ],
      { screenSequences: jest.fn(async () => granted) }
    );
    await h.service.screenJob('job-1', 'user-1');
    const patch = closed(h.screeningRuns);
    expect(patch.unscreenedNotes.join(' ')).toContain('was not uploaded');
    expect(patch.status).toBe('PASSED');
  });

  it('a collection that throws blocks through unscreenedNotes', async () => {
    const h = harness(gibson);
    const original = h.workflowService.findByIds.getMockImplementation();
    let calls = 0;
    h.workflowService.findByIds.mockImplementation(async (...args: unknown[]) => {
      if (++calls === 2) throw new Error('mongo down');
      return original(...args);
    });
    await h.service.screenJob('job-1', 'user-1');
    const patch = closed(h.screeningRuns);
    expect(patch.unscreenedNotes).toHaveLength(1);
    expect(patch.unscreenedNotes[0]).toMatch(/^Could not read the job's sequences/);
    expect(patch.sequenceCount).toBe(0);
  });

  it('a job write that throws is closed with a note', async () => {
    const setHomologyScreening = jest.fn(async () => {
      throw new Error('write failed');
    });
    const h = harness(gibson, { setHomologyScreening, screenSequences: jest.fn(async () => granted) });
    await expect(h.service.screenJob('job-1', 'user-1')).rejects.toThrow('write failed');
    const patch = closed(h.screeningRuns);
    expect(patch.unscreenedNotes).toEqual(['write failed']);
    expect(patch.status).toBe('UNAVAILABLE');
  });

  it('the close carries sequenceCount', async () => {
    const two = [
      { id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_A }] },
      { id: 'n2', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value: DNA_B }] }
    ];
    const h = harness(two, { screenSequences: jest.fn(async () => granted) });
    await h.service.screenJob('job-1', 'user-1');
    expect(closed(h.screeningRuns).sequenceCount).toBe(2);
  });
});

describe('acceptanceScreening', () => {
  const nodes = (value: string): Array<{ id: string; serviceName: string; formData: unknown }> => [{ id: 'n1', serviceName: GIBSON_ASSEMBLY_SERVICE_NAME, formData: [{ id: 'insert', value }] }];
  const jobIn = (state: JobState): Partial<Job> => ({ _id: 'job-1', workflows: [WORKFLOW_ID], state } as unknown as Partial<Job>);
  const runFor = (fingerprint: string): any => ({
    status: HomologyScreeningStatus.PASSED,
    completedAt: new Date(),
    sequenceCount: 1,
    fingerprint,
    unscreenedNotes: [],
    customer: { status: CustomerScreeningStatus.NOT_AVAILABLE },
    aclid: { homologyStatus: HomologyScreeningStatus.PASSED }
  });
  const withNewest = (screeningRuns: any, run: unknown): any => ({ ...screeningRuns, findNewestForJob: jest.fn(async () => run) });

  it('reads the newest run and the current fingerprint', async () => {
    const probe = harness(nodes(DNA_A), { job: jobIn(JobState.SUBMITTED) });
    const fingerprint = await probe.service.screeningFingerprint(probe.job!);
    const h = harness(nodes(DNA_A), { job: jobIn(JobState.SUBMITTED), screeningRuns: withNewest(probe.screeningRuns, runFor(fingerprint)) });

    await expect(h.service.acceptanceScreening(h.job!)).resolves.toEqual({ state: JobAcceptanceScreeningState.CLEAR, message: null });
    expect(h.screeningRuns.findNewestForJob).toHaveBeenCalledWith('job-1');
  });

  it('NOT_REQUIRED without any read for an accepted job', async () => {
    const h = harness(nodes(DNA_A), { job: jobIn(JobState.ACCEPTED) });
    await expect(h.service.acceptanceScreening(h.job!)).resolves.toMatchObject({ state: JobAcceptanceScreeningState.NOT_REQUIRED });
    expect(h.screeningRuns.findNewestForJob).not.toHaveBeenCalled();
  });

  it('fails closed when the check cannot be made', async () => {
    const screeningRuns = { findNewestForJob: jest.fn(async () => Promise.reject(new Error('db down'))) };
    const h = harness(nodes(DNA_A), { job: jobIn(JobState.SUBMITTED), screeningRuns });
    await expect(h.service.acceptanceScreening(h.job!)).resolves.toEqual({ state: JobAcceptanceScreeningState.NOT_PASSED, message: ACCEPTANCE_MESSAGES.CHECK_FAILED });
    await expect(h.service.acceptanceScreening(h.job!, { callerCanScreen: false })).resolves.toMatchObject({ message: ACCEPTANCE_MESSAGES.CHECK_FAILED + ACCEPTANCE_MESSAGES.NO_BIOSECURITY_ACCESS });
  });

  it('a value edited after the run reads STALE (behaviour 11, Review Focus 1)', async () => {
    const before = harness(nodes(DNA_A), { job: jobIn(JobState.SUBMITTED) });
    const fingerprint = await before.service.screeningFingerprint(before.job!);
    const edited = harness(nodes(DNA_B), { job: jobIn(JobState.SUBMITTED), screeningRuns: withNewest(before.screeningRuns, runFor(fingerprint)) });

    await expect(edited.service.acceptanceScreening(edited.job!)).resolves.toEqual({ state: JobAcceptanceScreeningState.STALE, message: ACCEPTANCE_MESSAGES.STALE });
  });
});

describe('collectScreeningTargets from flagged files (biosecurity-tweaks)', () => {
  const PROTEIN = 'MKTAYIAKQRQISFVKSHFSRQLEEPMKTAYIAKQR';
  const fileParam = { id: 'seqs', name: 'Sequences', type: 'file', allowMultipleValues: true, screening: true };
  const stored = (name: string): string => JSON.stringify({ filename: name, key: `workflow-parameters/user-1/${name}` });
  const node = (value: unknown, param: any = fileParam): Array<{ id: string; serviceName: string; parameters: any[]; formData: unknown }> => [
    { id: 'n1', serviceName: 'Cloning', parameters: [param], formData: [{ id: 'seqs', value }] }
  ];

  it('labels every record of every file: 2 + 3 = 5 (behaviour 12)', async () => {
    const bodies: Record<string, string> = {
      'workflow-parameters/user-1/a.fasta': `>a1\n${DNA_A}\n>a2\n${DNA_B}\n`,
      'workflow-parameters/user-1/b.fasta': `>b1\n${DNA_A}\n> \n${DNA_B}\n>b3\n${DNA_A}\n`
    };
    const readObject = jest.fn(async (key: string) => Buffer.from(bodies[key]));
    const { service, job } = harness(node([stored('a.fasta'), stored('b.fasta')]), { readObject });
    const { targets, notes } = await service.collectScreeningTargets(job!);
    expect(readObject).toHaveBeenCalledWith('workflow-parameters/user-1/a.fasta', 10 * 1024 * 1024);
    expect(targets.map((t) => [t.name, t.label])).toEqual([
      [`${WORKFLOW_ID}_n1_seqs_f1_s1`, 'Cloning › Sequences › a.fasta › a1'],
      [`${WORKFLOW_ID}_n1_seqs_f1_s2`, 'Cloning › Sequences › a.fasta › a2'],
      [`${WORKFLOW_ID}_n1_seqs_f2_s1`, 'Cloning › Sequences › b.fasta › b1'],
      [`${WORKFLOW_ID}_n1_seqs_f2_s2`, 'Cloning › Sequences › b.fasta › record 2'],
      [`${WORKFLOW_ID}_n1_seqs_f2_s3`, 'Cloning › Sequences › b.fasta › b3']
    ]);
    expect(notes).toEqual([]);
  });

  it('skips and counts a protein record, and a too-short one (behaviour 13)', async () => {
    const readObject = jest.fn(async () => Buffer.from(`>d\n${DNA_A}\n>p\n${PROTEIN}\n>short\nATGCATGC\n`));
    const { service, job } = harness(node(stored('m.fasta')), { readObject });
    const { targets, skippedCount, notes } = await service.collectScreeningTargets(job!);
    expect(targets.map((t) => t.seq)).toEqual([DNA_A]);
    expect(skippedCount).toBe(2);
    expect(notes).toEqual([]);
  });

  it('notes a missing, oversized, unparseable or DNA-less file by name (behaviour 14)', async () => {
    const readObject = jest.fn(async (key: string) => {
      if (key.endsWith('big.fasta')) throw new ObjectTooLargeError();
      if (key.endsWith('notes.txt')) return Buffer.from('The quick brown fox jumps over the lazy dog.\nHello world.\n');
      return Buffer.from(`>p\n${PROTEIN}\n`);
    });
    const climbing = JSON.stringify({ filename: 'up.fasta', key: 'workflow-parameters/../x.fasta' });
    const { service, job } = harness(node([climbing, stored('big.fasta'), stored('notes.txt'), stored('prot.fasta')]), { readObject });
    const { targets, notes } = await service.collectScreeningTargets(job!);
    expect(targets).toEqual([]);
    expect(notes).toEqual([
      'Cloning › Sequences: up.fasta was not uploaded, so it was not screened',
      'Cloning › Sequences: could not read big.fasta (The stored object is larger than the read limit.)',
      'Cloning › Sequences: notes.txt is not a sequence file we can read',
      'Cloning › Sequences: prot.fasta has no DNA sequence in it'
    ]);
  });

  it('an unanswered flagged file adds nothing (Review Focus 3)', async () => {
    const readObject = jest.fn();
    const { service, job } = harness(node(null), { readObject });
    expect(await service.collectScreeningTargets(job!)).toEqual({ targets: [], skippedCount: 0, notes: [] });
    expect(readObject).not.toHaveBeenCalled();
  });

  it('replacing a flagged file changes the fingerprint, without reading it (behaviour 15)', async () => {
    const readObject = jest.fn();
    const a = harness(node(stored('a.fasta')), { readObject });
    const b = harness(node(stored('b.fasta')), { readObject });
    expect(await a.service.screeningFingerprint(a.job!)).not.toBe(await b.service.screeningFingerprint(b.job!));
    expect(readObject).not.toHaveBeenCalled();
  });

  it('fileRecordSliceName stays within 200 characters and keeps its suffix', () => {
    const name = fileRecordSliceName(WORKFLOW_ID, 'n'.repeat(300), 'seqs', 12, 345);
    expect(name).toHaveLength(200);
    expect(name.endsWith('_f12_s345')).toBe(true);
  });
});
