import { HttpException, HttpStatus } from '@nestjs/common';
import { AclidScreenPendingError } from '../aclid/aclid.service';
import { JobScreeningService } from './job-screening.service';
import { HomologyScreeningStatus, Job } from './job.model';
import { ScreeningRunTrigger } from './screening-run.model';

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
      return node ? { name: node.serviceName, parameters: node.parameters ?? PARAMETERS_BY_SERVICE[node.serviceName] ?? [] } : null;
    })
  };
  const screenSequences = overrides.screenSequences ?? jest.fn();
  const secureDnaService: any = { screenSequences };

  const screenInline = overrides.screenInline ?? jest.fn();
  const aclidService: any = { isConfigured: () => overrides.aclidConfigured ?? false, screenInline, getScreen: jest.fn(), getScreenDetails: jest.fn(async () => null) };

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
    updateAclidLeg: jest.fn<Promise<void>, [string, Record<string, unknown>, Record<string, unknown>]>(async () => undefined)
  };

  const service = new JobScreeningService(jobService, workflowService, workflowNodeService, dampLabServices, secureDnaService, aclidService, files, screeningRuns);
  return { service, job, setHomologyScreening, setAclidScreening, appendScreeningBatchId, screenSequences, screenInline, files, screeningRuns };
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

  it('keeps the verdict and notes it when the details call fails; a 204 stores no details (behaviour 13)', async () => {
    process.env.BIOSECURITY_HOMOLOGY_MODE = 'aclid';
    const { service, screeningRuns, setAclidScreening } = harness(gibson, { aclidConfigured: true, screenInline: jest.fn(async () => aclidScreen()) });
    (service as any).aclidService.getScreenDetails = jest.fn(async () => {
      throw new Error('Aclid returned 500');
    });
    await service.screenJob('job-1', 'user-1');
    expect(closing(screeningRuns).aclid).toMatchObject({ homologyStatus: 'PASSED', details: null, detail: 'Aclid details unavailable: Aclid returned 500' });
    expect(lastCall(setAclidScreening).homologyStatus).toBe(HomologyScreeningStatus.PASSED);
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
    expect(leg).toMatchObject({ homologyStatus: 'FAILED', regulatoryStatus: 'controlled', status: 'succeeded', details, detail: null, raw: { id: 'scr_1' } });
    expect(patch).toMatchObject({ status: 'FAILED' });
    expect(screeningRuns.create).not.toHaveBeenCalled();
  });

  it('does not fetch details again when the run already has them, and leaves the run status unless it now fails', async () => {
    const screeningRuns = {
      create: jest.fn(),
      update: jest.fn(),
      findByAclidScreenId: jest.fn(async () => run({ screenId: 'scr_1', details: { a: {} } })),
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
