import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SOWService } from './sow.service';
import { CreateSOWInput } from './dto/create-sow.input';

/**
 * Generating the first SOW for a job.
 *
 * This is the path behind "Generate SOW". The failures it guards against are the
 * ones that turn a button click into a raw exception: a job whose services carry
 * no deliverables, a job with nothing on it at all, and a second click arriving
 * before the first has finished.
 */

interface Harness {
  service: SOWService;
  created: CreateSOWInput[];
}

function harness(opts: { existingSow?: unknown; job?: unknown; deliverablesById?: Record<string, string[]> } = {}): Harness {
  const created: CreateSOWInput[] = [];

  const sowModel: any = {
    findOne: () => ({ exec: async () => opts.existingSow ?? null })
  };

  const dampLabServices: any = {
    findOne: async (id: string) => ({ deliverables: opts.deliverablesById?.[id] ?? [] })
  };

  const jobService: any = {
    findById: async () => (opts.job === undefined ? { _id: 'job1', name: 'Job', username: 'jdoe', email: 'j@bu.edu', institute: 'BU' } : opts.job)
  };

  const service = new SOWService(sowModel, dampLabServices, jobService, {} as any);
  // `create` is covered by its own tests; here we only care what it is handed.
  (service as any).create = async (input: CreateSOWInput): Promise<unknown> => {
    created.push(input);
    return { _id: 'sow1', ...input };
  };

  return { service, created };
}

function serviceInput(over: Partial<CreateSOWInput['services'][number]> = {}): CreateSOWInput['services'][number] {
  return { id: 'svc-a', name: 'PCR', description: 'PCR', cost: 5, category: 'molecular-biology', formData: [], ...over } as any;
}

describe('createForJob', () => {
  it('returns the SOW the job already has instead of failing', async () => {
    const { service, created } = harness({ existingSow: { _id: 'existing', sowNumber: 'SOW 00004' } });

    const result = await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    expect((result as any)._id).toBe('existing');
    // A second click must not attempt a create that the unique job index rejects.
    expect(created).toHaveLength(0);
  });

  it('rejects a job with no services in words a staff member can act on', async () => {
    const { service } = harness();

    await expect(service.createForJob('job1', [], 'tech@bu.edu')).rejects.toThrow(BadRequestException);
    await expect(service.createForJob('job1', [], 'tech@bu.edu')).rejects.toThrow(/Add a workflow to the job first/);
  });

  it('fails clearly when the job does not exist', async () => {
    const { service } = harness({ job: null });

    await expect(service.createForJob('missing', [serviceInput()], 'tech@bu.edu')).rejects.toThrow(NotFoundException);
  });

  it('carries each line item through untouched, formData included', async () => {
    const { service, created } = harness();
    // The multiplier is read from formData downstream; losing it here reprices a
    // 70-run job as a single run, which is the bug this whole flow started with.
    const services = [serviceInput({ formData: [{ id: '__runCount', value: 70 }] })];

    await service.createForJob('job1', services, 'tech@bu.edu');

    expect(created[0].services).toEqual(services);
  });

  it('leaves pricing figures to the server rather than asserting its own', async () => {
    const { service, created } = harness();

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    // Supplying baseCost/totalCost here would re-enter the consistency check that
    // has no independent figure to offer — let `create` compute both.
    expect(created[0].pricing.baseCost).toBeUndefined();
    expect(created[0].pricing.totalCost).toBeUndefined();
    expect(created[0].pricing.adjustments).toEqual([]);
  });

  it('names the client from the job, preferring the checkout display name', async () => {
    const { service, created } = harness({
      job: { _id: 'job1', name: 'Project X', clientDisplayName: 'Dr. Jane Rivera', username: 'jrivera', email: 'jane@bu.edu', institute: 'Boston University' }
    });

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    expect(created[0].clientName).toBe('Dr. Jane Rivera');
    expect(created[0].clientEmail).toBe('jane@bu.edu');
    expect(created[0].clientInstitution).toBe('Boston University');
  });

  it('falls back to the username when no display name was captured', async () => {
    const { service, created } = harness({ job: { _id: 'job1', name: 'Project X', username: 'jrivera', email: 'jane@bu.edu', institute: 'BU' } });

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    expect(created[0].clientName).toBe('jrivera');
  });

  it('does not set a title, so the document keeps one source for the default', async () => {
    const { service, created } = harness();

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    expect(created[0].sowTitle).toBeUndefined();
  });

  it('opens the scope with one line per distinct service', async () => {
    const { service, created } = harness();

    await service.createForJob('job1', [serviceInput({ id: 'a', name: 'PCR' }), serviceInput({ id: 'b', name: 'Gel Electrophoresis' })], 'tech@bu.edu');

    expect(created[0].scopeOfWork).toEqual(['Perform PCR', 'Perform Gel Electrophoresis']);
  });

  it('counts a service that appears more than once rather than repeating the line', async () => {
    const { service, created } = harness();

    await service.createForJob('job1', [serviceInput({ id: 'a', name: 'PCR' }), serviceInput({ id: 'a', name: 'PCR' })], 'tech@bu.edu');

    expect(created[0].scopeOfWork).toEqual(['Perform PCR (2 instances)']);
  });

  it('takes deliverables from the service records, without duplicates', async () => {
    const { service, created } = harness({ deliverablesById: { a: ['Plasmid DNA', 'Glycerol stocks'], b: ['Plasmid DNA', 'Sequencing report'] } });

    await service.createForJob('job1', [serviceInput({ id: 'a' }), serviceInput({ id: 'b' })], 'tech@bu.edu');

    expect(created[0].deliverables).toEqual(['Plasmid DNA', 'Glycerol stocks', 'Sequencing report']);
  });

  it('supplies placeholder deliverables when no service defines any', async () => {
    const { service, created } = harness();

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    // Seeded services usually carry none, and an empty array fails validation —
    // which would surface to staff as "deliverables cannot be empty".
    expect(created[0].deliverables.length).toBeGreaterThan(0);
  });

  it('opens as a draft over a two-week timeline', async () => {
    const { service, created } = harness();

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    const { startDate, endDate, duration } = created[0].timeline;
    const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    expect(days).toBe(14);
    expect(duration).toBe('14 days');
    expect(created[0].status).toBe('DRAFT');
  });

  it('records who generated it', async () => {
    const { service, created } = harness();

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    expect(created[0].createdBy).toBe('tech@bu.edu');
  });
});
