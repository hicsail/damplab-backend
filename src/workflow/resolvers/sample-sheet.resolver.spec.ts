import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SampleSheetResolver } from './sample-sheet.resolver';
import { JobState } from '../../job/job.model';
import { Role } from '../../auth/roles/roles.enum';

const service = { _id: 'svc', name: 'Prep', price: 5, parameters: [{ id: 'sheet', name: 'Samples', type: 'sampleSheet', templateFile: { key: 'sample-sheet-templates/blank.xlsx' } }] };
const input = (sub: string): any => ({
  jobId: 'job-1',
  nodeId: 'node-1',
  parameterId: 'sheet',
  file: { key: `workflow-parameters/${sub}/new.xlsx`, filename: 'new.xlsx', contentType: 'x', size: 1, sampleCount: 4 }
});
const user = (sub: string, email: string, roles: string[] = []): any => ({ sub, email, realm_access: { roles } });

function harness(jobOver: any = {}, over: { service?: any; nodeFormData?: any[]; readObject?: jest.Mock } = {}): { resolver: SampleSheetResolver; setFormDataValue: jest.Mock; readObject: jest.Mock } {
  const svc = over.service ?? service;
  const node = { _id: 'node-1', label: 'Prep step', service: svc, formData: over.nodeFormData ?? [], price: 5, parameterSnapshot: [] };
  const job = { _id: 'job-1', sub: 'owner', email: 'owner@x.org', memberEmails: ['member@x.org'], state: JobState.SUBMITTED, ...jobOver };
  const setFormDataValue = jest.fn(async (_n: any, _p: string, _v: string, _m: any, priceFor: any, snapshotFor: any) => ({
    ...node,
    price: priceFor([{ id: _p, value: _v }]),
    parameterSnapshot: snapshotFor([{ id: _p, value: _v }])
  }));
  const readObject = over.readObject ?? jest.fn(async () => Buffer.from('Sample\ns1\ns2\ns3\n'));
  const nodeService: any = { getByID: jest.fn(async () => node), getJobForNode: jest.fn(async () => job), setFormDataValue };
  const resolver = new SampleSheetResolver({ readObject } as any, { findOne: async () => svc } as any, nodeService, { syncServicesFromJobWorkflows: jest.fn(async () => undefined) } as any);
  return { resolver, setFormDataValue, readObject };
}

describe('replaceSampleSheet — edit access (B18)', () => {
  it('refuses a member while the job is with the lab, with the edit-access message', async () => {
    const { resolver, setFormDataValue } = harness();
    await expect(resolver.replaceSampleSheet(input('member'), user('member', 'member@x.org'))).rejects.toThrow(BadRequestException);
    await expect(resolver.replaceSampleSheet(input('member'), user('member', 'member@x.org'))).rejects.toThrow(/cannot be edited right now/);
    expect(setFormDataValue).not.toHaveBeenCalled();
  });

  it('lets a member replace while the lab has asked them to edit, and writes the snapshot (B21)', async () => {
    const { resolver, setFormDataValue } = harness({ state: JobState.CHANGES_REQUESTED, customerActionRequired: 'EDIT_WORKFLOW' });
    const updated: any = await resolver.replaceSampleSheet(input('member'), user('member', 'member@x.org'));
    expect(setFormDataValue).toHaveBeenCalled();
    expect(updated.parameterSnapshot).toEqual([{ id: 'sheet', name: 'Samples', type: 'sampleSheet', displayValue: 'new.xlsx' }]);
  });

  it('keeps damplab-staff unchanged in any open state', async () => {
    const { resolver, setFormDataValue } = harness();
    await resolver.replaceSampleSheet(input('admin'), user('admin', 'a@bu.edu', [Role.DamplabStaff]));
    expect(setFormDataValue).toHaveBeenCalled();
  });

  // Approved at the plan gate: technicians keep Replace via jobs:view-all.
  it('keeps a technician (jobs:view-all) able to replace, as TechnicianView offers', async () => {
    const { resolver, setFormDataValue } = harness();
    await resolver.replaceSampleSheet(input('tech'), user('tech', 't@bu.edu', [Role.Technician]));
    expect(setFormDataValue).toHaveBeenCalled();
  });

  it('still refuses a stranger with Forbidden', async () => {
    const { resolver } = harness({ state: JobState.CHANGES_REQUESTED, customerActionRequired: 'EDIT_WORKFLOW' });
    await expect(resolver.replaceSampleSheet(input('x'), user('x', 'x@x.org'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('parameterSetSampleSheetTemplateUrl', () => {
  const template = { key: 'sample-sheet-templates/abc.xlsx', filename: 'blank.xlsx', contentType: 'application/xlsx' };
  function setHarness(parameters: any[] | null): { resolver: SampleSheetResolver; createPresignedDownload: jest.Mock } {
    const createPresignedDownload = jest.fn(async (key: string) => `https://s3/${key}`);
    const services: any = { findParameterSet: jest.fn(async () => (parameters ? { _id: 'set-1', name: 'Samples', parameters } : null)) };
    return { resolver: new SampleSheetResolver({ createPresignedDownload } as any, services, {} as any, {} as any), createPresignedDownload };
  }

  it('presigns the key stored on the set’s parameter', async () => {
    const { resolver, createPresignedDownload } = setHarness([{ id: 'sheet', type: 'sampleSheet', templateFile: template }]);
    await expect(resolver.parameterSetSampleSheetTemplateUrl('set-1', 'sheet')).resolves.toBe('https://s3/sample-sheet-templates/abc.xlsx');
    expect(createPresignedDownload).toHaveBeenCalledWith(template.key, template.contentType);
  });

  it('presigns the template of a parameter stored as `table` as it does a `sampleSheet`', async () => {
    const { resolver, createPresignedDownload } = setHarness([{ id: 'sheet', type: 'table', templateFile: template }]);
    await expect(resolver.parameterSetSampleSheetTemplateUrl('set-1', 'sheet')).resolves.toBe('https://s3/sample-sheet-templates/abc.xlsx');
    expect(createPresignedDownload).toHaveBeenCalledWith(template.key, template.contentType);
  });

  it('is null when the set, the parameter or the template is missing', async () => {
    await expect(setHarness(null).resolver.parameterSetSampleSheetTemplateUrl('gone', 'sheet')).resolves.toBeNull();
    await expect(setHarness([{ id: 'other', type: 'string' }]).resolver.parameterSetSampleSheetTemplateUrl('set-1', 'sheet')).resolves.toBeNull();
    await expect(setHarness([{ id: 'sheet', type: 'sampleSheet' }]).resolver.parameterSetSampleSheetTemplateUrl('set-1', 'sheet')).resolves.toBeNull();
  });

  it('never presigns a key outside the template prefix', async () => {
    const { resolver, createPresignedDownload } = setHarness([{ id: 'sheet', type: 'sampleSheet', templateFile: { key: 'workflow-parameters/someone/private.xlsx' } }]);
    await expect(resolver.parameterSetSampleSheetTemplateUrl('set-1', 'sheet')).resolves.toBeNull();
    expect(createPresignedDownload).not.toHaveBeenCalled();
  });
});

describe('replaceSampleSheet — the server reads the file (table-upload rules 22–24, 26)', () => {
  const staff = user('admin', 'a@bu.edu', [Role.DamplabStaff]);
  const tableService = {
    _id: 'svc',
    name: 'Prep',
    pricingMode: 'PARAMETER',
    parameters: [{ id: 'sheet', name: 'Samples', type: 'table', price: 2, tableData: { columns: [{ header: 'Sample', field: 'sample' }] } }]
  };

  it('stores its own row count and ignores the client’s sampleCount, however wrong or malformed', async () => {
    const { resolver, setFormDataValue, readObject } = harness({}, { service: tableService });
    const lying = input('admin');
    lying.file.sampleCount = -5;
    const updated: any = await resolver.replaceSampleSheet(lying, staff);
    expect(readObject).toHaveBeenCalledWith('workflow-parameters/admin/new.xlsx', 10 * 1024 * 1024);
    const stored = JSON.parse(setFormDataValue.mock.calls[0][2]);
    expect(stored).toMatchObject({ filename: 'new.xlsx', key: 'workflow-parameters/admin/new.xlsx', sampleCount: 3, countedBy: 'server' });
    expect(updated.price).toBe(6);
  });

  it('refuses a file missing a column as a BadRequest naming the operation, and writes nothing', async () => {
    const { resolver, setFormDataValue } = harness({}, { service: tableService, readObject: jest.fn(async () => Buffer.from('Strain\nBL21\n')) });
    await expect(resolver.replaceSampleSheet(input('admin'), staff)).rejects.toBeInstanceOf(BadRequestException);
    await expect(resolver.replaceSampleSheet(input('admin'), staff)).rejects.toThrow('“Samples” on “Prep step”: This file is missing the columns: Sample.');
    expect(setFormDataValue).not.toHaveBeenCalled();
  });

  it('refuses a file storage cannot return', async () => {
    const failing = jest.fn(async () => {
      throw new Error('NoSuchKey');
    });
    const { resolver, setFormDataValue } = harness({}, { service: tableService, readObject: failing });
    await expect(resolver.replaceSampleSheet(input('admin'), staff)).rejects.toThrow('This file could not be read; upload it again.');
    expect(setFormDataValue).not.toHaveBeenCalled();
  });

  it('still refuses a foreign key before anything is read', async () => {
    const { resolver, readObject } = harness({}, { service: tableService });
    await expect(resolver.replaceSampleSheet(input('someone-else'), staff)).rejects.toBeInstanceOf(ForbiddenException);
    expect(readObject).not.toHaveBeenCalled();
  });

  it('writes the stored value back unchanged when the key named is the one already stored', async () => {
    const storedValue = JSON.stringify({ filename: 'new.xlsx', key: 'workflow-parameters/admin/new.xlsx', contentType: 'x', size: 1, sampleCount: 40, uploadedAt: '2026-09-01T00:00:00.000Z' });
    const { resolver, setFormDataValue, readObject } = harness({}, { service: tableService, nodeFormData: [{ id: 'sheet', value: storedValue }] });
    await resolver.replaceSampleSheet(input('admin'), staff);
    expect(readObject).not.toHaveBeenCalled();
    expect(setFormDataValue.mock.calls[0][2]).toBe(storedValue);
  });

  it('finds the parameter under either stored type string', async () => {
    const { resolver, setFormDataValue } = harness();
    await resolver.replaceSampleSheet(input('admin'), staff);
    expect(setFormDataValue).toHaveBeenCalled();
  });
});

describe('the template queries find a Table stored under either string', () => {
  const template = { key: 'sample-sheet-templates/abc.xlsx', filename: 'blank.xlsx', contentType: 'application/xlsx' };
  it.each(['table', 'sampleSheet'])('%s on an operation', async (type) => {
    const createPresignedDownload = jest.fn(async (key: string) => `https://s3/${key}`);
    const services: any = { findOne: jest.fn(async () => ({ _id: 'svc', parameters: [{ id: 'sheet', type, templateFile: template }] })) };
    const resolver = new SampleSheetResolver({ createPresignedDownload } as any, services, {} as any, {} as any);
    await expect(resolver.sampleSheetTemplateUrl('svc', 'sheet')).resolves.toBe('https://s3/sample-sheet-templates/abc.xlsx');
  });
});
