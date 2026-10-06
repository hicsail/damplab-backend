import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SampleSheetResolver } from './sample-sheet.resolver';
import { JobState } from '../../job/job.model';
import { Role } from '../../auth/roles/roles.enum';

const service = { _id: 'svc', name: 'Prep', price: 5, parameters: [{ id: 'sheet', name: 'Samples', type: 'sampleSheet' }] };
const input = (sub: string): any => ({
  jobId: 'job-1',
  nodeId: 'node-1',
  parameterId: 'sheet',
  file: { key: `workflow-parameters/${sub}/new.xlsx`, filename: 'new.xlsx', contentType: 'x', size: 1, sampleCount: 4 }
});
const user = (sub: string, email: string, roles: string[] = []): any => ({ sub, email, realm_access: { roles } });

function harness(jobOver: any = {}): { resolver: SampleSheetResolver; setFormDataValue: jest.Mock } {
  const node = { _id: 'node-1', service: service, formData: [], price: 5, parameterSnapshot: [] };
  const job = { _id: 'job-1', sub: 'owner', email: 'owner@x.org', memberEmails: ['member@x.org'], state: JobState.SUBMITTED, ...jobOver };
  const setFormDataValue = jest.fn(async (_n: any, _p: string, _v: string, _m: any, priceFor: any, snapshotFor: any) => ({
    ...node,
    price: priceFor([]),
    parameterSnapshot: snapshotFor([{ id: 'sheet', value: _v }])
  }));
  const nodeService: any = { getByID: jest.fn(async () => node), getJobForNode: jest.fn(async () => job), setFormDataValue };
  const resolver = new SampleSheetResolver({} as any, { findOne: async () => service } as any, nodeService, { syncServicesFromJobWorkflows: jest.fn(async () => undefined) } as any);
  return { resolver, setFormDataValue };
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
