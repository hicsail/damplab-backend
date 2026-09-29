import { ParameterSetsService } from './parameter-sets.service';

const SET_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SET_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const query = <T>(value: T): any => {
  const p: any = Promise.resolve(value);
  p.exec = (): Promise<T> => Promise.resolve(value);
  p.sort = (): any => query(value);
  return p;
};

function fakeModel(seed: any[]): any {
  const rows = seed.map((r) => ({ ...r }));
  return {
    rows,
    find: jest.fn((filter: any = {}) => query(filter._id ? rows.filter((r) => filter._id.$in.map(String).includes(String(r._id))) : rows)),
    findById: jest.fn((id: string) => query(rows.find((r) => String(r._id) === String(id)) ?? null)),
    findOne: jest.fn((filter: any) => query(rows.find((r) => new RegExp(filter.name.$regex, filter.name.$options).test(r.name)) ?? null)),
    create: jest.fn(async (doc: any) => {
      const row = { _id: 'cccccccccccccccccccccccc', ...doc };
      rows.push(row);
      return row;
    }),
    updateOne: jest.fn((filter: any, update: any) => query(Object.assign(rows.find((r) => String(r._id) === String(filter._id)) ?? {}, update.$set))),
    deleteOne: jest.fn(() => query({ deletedCount: 1 }))
  };
}

const buffers = { _id: SET_A, name: 'Buffers', parameters: [{ id: 'buffer' }] };
const cleanup = { _id: SET_B, name: 'Cleanup', parameters: [{ id: 'kit' }] };

const build = (sets: any[], users: any[] = []): { svc: ParameterSetsService; model: any } => {
  const model = fakeModel(sets);
  const services = { findUsingParameterSet: jest.fn(async () => users) };
  return { svc: new ParameterSetsService(model, services as any), model };
};

describe('ParameterSetsService', () => {
  it('creates a set with a trimmed name and cleaned parameters', async () => {
    const { svc, model } = build([]);
    await svc.create({ name: ' Buffers ', parameters: [{ id: 'buffer', paramGroupId: 'g' }] });
    expect(model.create).toHaveBeenCalledWith({ name: 'Buffers', description: undefined, parameters: [{ id: 'buffer' }] });
  });

  it('rejects ; and case-insensitive duplicate names (Review Focus 4)', async () => {
    const { svc } = build([buffers]);
    await expect(svc.create({ name: 'buffers', parameters: [] })).rejects.toThrow('A parameter set named "Buffers" already exists.');
    await expect(svc.create({ name: 'A; B', parameters: [] })).rejects.toThrow(/cannot contain ";"/);
  });

  it('allows renaming a set to a different case of its own name', async () => {
    const { svc } = build([buffers]);
    await expect(svc.update(SET_A, { name: 'BUFFERS' })).resolves.toMatchObject({ name: 'BUFFERS' });
  });

  it('refuses a parameter change that would clash on an operation using the set, naming the operation (pin 7)', async () => {
    const pcr = { _id: 'op1', name: 'PCR', parameterSetIds: [SET_A, SET_B] };
    const { svc, model } = build([buffers, cleanup], [pcr]);
    await expect(svc.update(SET_A, { parameters: [{ id: 'kit' }] })).rejects.toThrow(/"PCR"/);
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('saves a parameter change that clashes with nothing', async () => {
    const pcr = { _id: 'op1', name: 'PCR', parameterSetIds: [SET_A, SET_B] };
    const { svc } = build([buffers, cleanup], [pcr]);
    await expect(svc.update(SET_A, { parameters: [{ id: 'buffer' }, { id: 'ph' }] })).resolves.toBeDefined();
  });

  it('refuses to delete a set an operation uses, naming the operations (pin 8)', async () => {
    const { svc, model } = build(
      [buffers],
      [
        { _id: 'op1', name: 'PCR' },
        { _id: 'op2', name: 'Gibson' }
      ]
    );
    await expect(svc.delete(SET_A)).rejects.toThrow('"Buffers" is used by "PCR", "Gibson". Remove it from those operations first.');
    expect(model.deleteOne).not.toHaveBeenCalled();
  });

  it('hard-deletes an unused set (pin 8)', async () => {
    const { svc, model } = build([buffers]);
    await expect(svc.delete(SET_A)).resolves.toBe(true);
    expect(model.deleteOne).toHaveBeenCalledWith({ _id: SET_A });
  });
});
