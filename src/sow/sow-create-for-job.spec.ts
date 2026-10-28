import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SOWService } from './sow.service';
import { CreateSOWInput } from './dto/create-sow.input';
import { SowPeriod } from './sow-version.model';

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
  createdOpts: Array<{ periods?: SowPeriod[] } | undefined>;
}

function harness(opts: { existingSow?: unknown; job?: unknown; deliverablesById?: Record<string, string[]> } = {}): Harness {
  const created: CreateSOWInput[] = [];
  const createdOpts: Array<{ periods?: SowPeriod[] } | undefined> = [];

  const sowModel: any = {
    findOne: () => ({ exec: async () => opts.existingSow ?? null })
  };

  const dampLabServices: any = {
    findOne: async (id: string) => ({ deliverables: opts.deliverablesById?.[id] ?? [] })
  };

  const jobService: any = {
    findById: async () => (opts.job === undefined ? { _id: 'job1', name: 'Job', username: 'jdoe', email: 'j@bu.edu', institute: 'BU' } : opts.job)
  };

  const service = new SOWService(sowModel, dampLabServices, jobService, {} as any, {} as any, {} as any);
  // `create` is covered by its own tests; here we only care what it is handed.
  (service as any).create = async (input: CreateSOWInput, opts?: { periods?: SowPeriod[] }): Promise<unknown> => {
    created.push(input);
    createdOpts.push(opts);
    return { _id: 'sow1', ...input };
  };

  return { service, created, createdOpts };
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

  it('bills the client staff named, not the staff member who submitted for them', async () => {
    // A staff-submitted job's `email` is the submitter's, read from their token.
    // Copying it here put the technician's address in the SOW parties block and
    // on the invoice as billedToEmail.
    const { service, created } = harness({
      job: { _id: 'job1', name: 'Project X', clientDisplayName: 'Dr. Jane Rivera', username: 'tess', email: 'tech@damplab.org', clientEmail: 'jane@bu.edu', institute: 'Boston University' }
    });

    await service.createForJob('job1', [serviceInput()], 'tech@damplab.org');

    expect(created[0].clientEmail).toBe('jane@bu.edu');
  });

  it('falls back to the username when no display name was captured', async () => {
    const { service, created } = harness({ job: { _id: 'job1', name: 'Project X', username: 'jrivera', email: 'jane@bu.edu', institute: 'BU' } });

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    expect(created[0].clientName).toBe('jrivera');
  });

  it('names a client with no account yet by their email, never by the job’s name', async () => {
    const { service, created } = harness({ job: { _id: 'job1', name: 'Project X', email: 'new@bu.edu', clientEmail: 'new@bu.edu', institute: 'BU' } });

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    expect(created[0].clientName).toBe('new@bu.edu');
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

  it('opens as a draft over a two-week timeline whose end date is the period’s last day (F1)', async () => {
    const { service, created, createdOpts } = harness();

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    const { startDate, endDate, duration } = created[0].timeline;
    const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    // 14 days inclusive: the last day is start + 13. It used to be start + 14,
    // one day past the period the timeline was meant to describe.
    expect(days).toBe(13);
    expect(duration).toBe('14 days');
    expect(createdOpts[0]?.periods).toEqual([{ startDate: new Date(startDate), durationDays: 14, label: undefined }]);
    expect(created[0].status).toBe('DRAFT');
  });

  const equipmentUse = (name: string, start: string, end: string): CreateSOWInput['services'][number] =>
    serviceInput({
      id: `svc-${name}`,
      name,
      formData: [
        { id: '__equipStart', value: start },
        { id: '__equipEnd', value: end }
      ]
    });
  const utc = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

  it('seeds the first draft from the Equipment Use dates, even beside ordinary services (behaviours 9, 10, 12)', async () => {
    const { service, created, createdOpts } = harness();

    await service.createForJob('job1', [serviceInput({ name: 'PCR' }), equipmentUse('Confocal', '2026-11-02', '2026-11-15')], 'tech@bu.edu');

    expect(createdOpts[0]?.periods).toEqual([{ startDate: utc('2026-11-02'), durationDays: 14, label: 'Confocal' }]);
    expect(created[0].timeline).toEqual({ startDate: utc('2026-11-02'), endDate: utc('2026-11-15'), duration: '14 days' });
  });

  it('spans the timeline from the earliest start to the latest inclusive end (behaviour 14)', async () => {
    const { service, created, createdOpts } = harness();

    await service.createForJob('job1', [equipmentUse('Flow cytometer', '2026-11-20', '2026-11-24'), equipmentUse('Confocal', '2026-11-02', '2026-11-06')], 'tech@bu.edu');

    expect(createdOpts[0]?.periods?.map((p) => p.label)).toEqual(['Confocal', 'Flow cytometer']);
    expect(created[0].timeline).toEqual({ startDate: utc('2026-11-02'), endDate: utc('2026-11-24'), duration: '23 days' });
  });

  it('leaves a SOW that already exists untouched, whatever the equipment dates now say (behaviour 15)', async () => {
    const { service, created } = harness({ existingSow: { _id: 'existing', timeline: { duration: '14 days' } } });

    const result = await service.createForJob('job1', [equipmentUse('Confocal', '2026-11-02', '2026-11-15')], 'tech@bu.edu');

    expect((result as any).timeline).toEqual({ duration: '14 days' });
    expect(created).toHaveLength(0);
  });

  it('records who generated it', async () => {
    const { service, created } = harness();

    await service.createForJob('job1', [serviceInput()], 'tech@bu.edu');

    expect(created[0].createdBy).toBe('tech@bu.edu');
  });
});
