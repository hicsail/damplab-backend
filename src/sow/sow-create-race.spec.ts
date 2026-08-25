import { BadRequestException } from '@nestjs/common';
import { SOWService } from './sow.service';
import { SOWStatus } from './sow.model';
import { CreateSOWInput } from './dto/create-sow.input';

/**
 * The two ways `sows` can reject an insert, and what each one means.
 *
 * Both the "does this job have a SOW" and "is this number free" checks in
 * SOWService are reads followed by a write, so the unique indexes are what
 * actually settle a tie. Which index rejects the insert says what happened:
 * `sowNumber` means someone else took that number and this SOW still needs one,
 * `jobId` means the job's SOW already exists and this one is redundant.
 *
 * Arranging a genuine simultaneous insert through the API is not something a
 * test can do reliably — the integration suite covers the outcome, and these
 * cover the branches by handing the service the rejection directly.
 */

function duplicateKeyError(key: string, value: string): Error & { code: number; keyPattern: Record<string, number> } {
  const error = new Error(`E11000 duplicate key error collection: damplab.sows index: ${key}_1 dup key: { ${key}: "${value}" }`) as any;
  error.code = 11000;
  error.keyPattern = { [key]: 1 };
  error.keyValue = { [key]: value };
  return error;
}

const JOB = { _id: 'job-1', name: 'Job', jobId: '00007', username: 'jdoe', email: 'j@bu.edu', institute: 'BU', customerCategory: 'INTERNAL_CUSTOMERS' };

interface Harness {
  service: SOWService;
  inserted: any[];
  /** How many times the initial version document was written. */
  versionsCreated: () => number;
}

function harness(opts: { failures?: Error[]; existingNumbers?: string[] } = {}): Harness {
  const failures = [...(opts.failures ?? [])];
  const inserted: any[] = [];
  let createdVersions = 0;

  // Rows already in the collection, as `find` projections and `findOne` lookups see them.
  const rows: any[] = (opts.existingNumbers ?? []).map((sowNumber) => ({ sowNumber, jobId: `other-${sowNumber}` }));

  const sowModel: any = {
    find: () => ({ lean: () => ({ exec: async () => rows }) }),
    findOne: (query: any) => ({
      exec: async () => rows.find((row) => (query.sowNumber ? row.sowNumber === query.sowNumber : row.jobId === query.jobId)) ?? null
    }),
    findById: () => ({ exec: async () => inserted[inserted.length - 1] }),
    create: async (data: any) => {
      const failure = failures.shift();
      if (failure) throw failure;
      const row = { ...data, _id: `sow-${inserted.length + 1}` };
      inserted.push(row);
      rows.push(row);
      return row;
    }
  };

  const dampLabServices: any = { findOne: async () => ({ deliverables: [] }) };
  const jobService: any = { findById: async () => JOB };
  const sowVersionService: any = {
    createInitialVersion: async (): Promise<void> => {
      createdVersions += 1;
    }
  };

  const service = new SOWService(sowModel, dampLabServices, jobService, sowVersionService, {} as any, {} as any);
  return { service, inserted, versionsCreated: () => createdVersions };
}

function input(over: Partial<CreateSOWInput> = {}): CreateSOWInput {
  return {
    jobId: 'job-1',
    clientName: 'Client',
    clientEmail: 'c@bu.edu',
    clientInstitution: 'BU',
    scopeOfWork: ['Do the work'],
    deliverables: ['A result'],
    services: [{ id: 'svc-a', name: 'PCR', description: 'PCR', cost: 100, category: 'molecular-biology', formData: [] } as any],
    timeline: { startDate: new Date('2026-01-01'), endDate: new Date('2026-02-01'), duration: '31 days' },
    resources: { projectManager: '', projectLead: '' },
    pricing: { adjustments: [] },
    additionalInformation: '',
    createdBy: 'tech@bu.edu',
    status: SOWStatus.DRAFT,
    ...over
  } as CreateSOWInput;
}

describe('SOWService.create under a duplicate-key rejection', () => {
  it('takes the next number when the one it picked was claimed first', async () => {
    // "SOW 00007" comes from the job's display id; the collision sends it to the
    // global sequence, which has to land somewhere else.
    const { service, inserted } = harness({ failures: [duplicateKeyError('sowNumber', 'SOW 00007')] });

    const sow: any = await service.create(input());

    expect(inserted).toHaveLength(1);
    expect(inserted[0].sowNumber).not.toBe('SOW 00007');
    expect(sow.sowNumber).toMatch(/^SOW \d{5}$/);
  });

  it('keeps trying past several claimed numbers', async () => {
    const { service, inserted } = harness({
      failures: [duplicateKeyError('sowNumber', 'SOW 00007'), duplicateKeyError('sowNumber', 'SOW 00001'), duplicateKeyError('sowNumber', 'SOW 00002')]
    });

    await service.create(input());

    expect(inserted).toHaveLength(1);
  });

  it('gives up rather than looping forever when every number is refused', async () => {
    const { service, inserted } = harness({
      failures: Array.from({ length: 10 }, (_, i) => duplicateKeyError('sowNumber', `SOW 0000${i}`))
    });

    await expect(service.create(input())).rejects.toMatchObject({ code: 11000 });
    expect(inserted).toHaveLength(0);
  });

  it('reports a job that already has a SOW rather than leaking the driver error', async () => {
    // The message must match the one the read-side check produces, so callers
    // cannot tell whether they lost the race or simply arrived second.
    const { service, inserted } = harness({ failures: [duplicateKeyError('jobId', 'job-1')] });

    // One rejection is queued, so this must be a single call: asserting the type
    // and the message separately would consume it twice and pass for the wrong reason.
    const error = await service.create(input()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toMatch(/already has a SOW/);
    expect(inserted).toHaveLength(0);
  });

  it('does not create the version document for an insert that never landed', async () => {
    const { service, versionsCreated } = harness({ failures: [duplicateKeyError('jobId', 'job-1')] });

    await expect(service.create(input())).rejects.toBeInstanceOf(BadRequestException);

    expect(versionsCreated()).toBe(0);
  });

  it('creates exactly one version document after a retry succeeds', async () => {
    const { service, versionsCreated } = harness({ failures: [duplicateKeyError('sowNumber', 'SOW 00007')] });

    await service.create(input());

    expect(versionsCreated()).toBe(1);
  });
});
