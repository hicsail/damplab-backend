import mongoose from 'mongoose';
import { ScreeningRunService } from './screening-run.service';
import { ScreeningRunSchema, ScreeningRunTrigger } from './screening-run.model';
import { HomologyScreeningStatus } from './job.model';

const JOB = '65a1b2c3d4e5f60718293a4b';
const RUN = '65a1b2c3d4e5f60718293a4c';

const chain = <T>(value: T): any => {
  const q: any = { exec: jest.fn(async () => value) };
  q.sort = jest.fn(() => q);
  q.select = jest.fn(() => q);
  return q;
};

function fakeModel(): any {
  const found = chain([{ _id: RUN }]);
  return {
    found,
    create: jest.fn(async (doc: any) => ({ _id: RUN, ...doc })),
    updateOne: jest.fn(() => chain({ acknowledged: true })),
    find: jest.fn(() => found),
    findById: jest.fn(() => chain({ _id: RUN })),
    findOne: jest.fn(() => chain({ _id: RUN }))
  };
}

describe('ScreeningRunService', () => {
  it('create returns the new run id', async () => {
    const model = fakeModel();
    const id = await new ScreeningRunService(model).create({
      jobId: JOB,
      trigger: ScreeningRunTrigger.RERUN,
      triggeredBy: 'staff@bu.edu',
      status: HomologyScreeningStatus.IN_PROGRESS,
      startedAt: new Date('2026-10-29T12:00:00Z'),
      sequenceCount: 0,
      skippedCount: 0,
      sequences: [],
      fingerprint: null
    });
    expect(id).toBe(RUN);
    expect(model.create.mock.calls[0][0]).toMatchObject({ trigger: 'RERUN', triggeredBy: 'staff@bu.edu' });
  });

  it('findForJob is newest first and leaves out the raw report and the details', async () => {
    const model = fakeModel();
    await new ScreeningRunService(model).findForJob(JOB);
    expect(model.find).toHaveBeenCalledWith({ jobId: JOB });
    expect(model.found.select).toHaveBeenCalledWith({ 'aclid.raw': 0, 'aclid.details': 0, 'customer.raw': 0 });
    expect(model.found.sort).toHaveBeenCalledWith({ startedAt: -1 });
  });

  it('findForJob and findById answer an invalid id with nothing, without a query', async () => {
    const model = fakeModel();
    const svc = new ScreeningRunService(model);
    await expect(svc.findForJob('nope')).resolves.toEqual([]);
    await expect(svc.findById('nope')).resolves.toBeNull();
    expect(model.find).not.toHaveBeenCalled();
    expect(model.findById).not.toHaveBeenCalled();
  });

  it('updateAclidLeg sets the leg field by field, so the rest of the leg survives', async () => {
    const model = fakeModel();
    await new ScreeningRunService(model).updateAclidLeg(RUN, { regulatoryStatus: 'controlled', details: { a: {} } }, { status: HomologyScreeningStatus.FAILED });
    expect(model.updateOne).toHaveBeenCalledWith({ _id: RUN }, { $set: { status: 'FAILED', 'aclid.regulatoryStatus': 'controlled', 'aclid.details': { a: {} } } });
  });

  it('findByAclidScreenId looks up the newest run carrying that screen', async () => {
    const model = fakeModel();
    await new ScreeningRunService(model).findByAclidScreenId('scr_1');
    expect(model.findOne).toHaveBeenCalledWith({ 'aclid.screenId': 'scr_1' });
  });

  it('findNewestForJob returns the newest run by startedAt, without the raw reports', async () => {
    const model = fakeModel();
    const q = chain({ _id: RUN });
    model.findOne = jest.fn(() => q);
    await expect(new ScreeningRunService(model).findNewestForJob(JOB)).resolves.toEqual({ _id: RUN });
    expect(model.findOne).toHaveBeenCalledWith({ jobId: JOB });
    expect(q.select).toHaveBeenCalledWith({ 'aclid.raw': 0, 'aclid.details': 0, 'customer.raw': 0 });
    expect(q.sort).toHaveBeenCalledWith({ startedAt: -1 });
  });

  it('findNewestForJob returns null for an invalid id, without a query', async () => {
    const model = fakeModel();
    await expect(new ScreeningRunService(model).findNewestForJob('nope')).resolves.toBeNull();
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('updateCustomerLeg sets the leg field by field', async () => {
    const model = fakeModel();
    await new ScreeningRunService(model).updateCustomerLeg('run-1', { detail: 'x' });
    expect(model.updateOne).toHaveBeenCalledWith({ _id: 'run-1' }, { $set: { 'customer.detail': 'x' } });
  });

  it('an older stored run reads an empty unscreenedNotes and null customer and fingerprint', () => {
    const Model = mongoose.model('ScreeningRunHydrateTest', ScreeningRunSchema);
    const run = Model.hydrate({
      _id: new mongoose.Types.ObjectId(),
      jobId: new mongoose.Types.ObjectId(),
      trigger: 'RERUN',
      status: 'PASSED',
      startedAt: new Date(),
      sequenceCount: 0,
      skippedCount: 0
    });
    expect(Array.from(run.unscreenedNotes)).toEqual([]);
    expect(run.customer ?? null).toBeNull();
    expect(run.fingerprint ?? null).toBeNull();
  });
});
