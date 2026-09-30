import { DampLabServices } from './damplab-services.services';

const SET_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SET_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

/** A Mongoose query stand-in: awaitable, and `.exec()`-able. */
const query = <T>(value: T): any => {
  const p: any = Promise.resolve(value);
  p.exec = (): Promise<T> => Promise.resolve(value);
  return p;
};

const sets = [
  {
    _id: SET_A,
    name: 'Buffers',
    parameters: [
      { id: 'buffer', name: 'Buffer' },
      { id: 'volume', name: 'Volume' }
    ]
  },
  { _id: SET_B, name: 'Cleanup', parameters: [{ id: 'volume', name: 'Final volume' }] }
];
const setModel = (): any => ({ find: jest.fn((filter: any) => query(sets.filter((s) => filter._id.$in.map(String).includes(s._id)))) });

const op = (over: Record<string, unknown> = {}): any => ({
  _id: 'op1',
  name: 'PCR',
  parameters: [{ id: 'cycles', name: 'Cycles' }],
  parameterSetIds: [SET_A],
  allowedConnections: [],
  protocolIds: [],
  deliverables: [],
  ...over
});

const serviceModel = (docs: any[]): any => ({
  find: jest.fn(() => query(docs)),
  findById: jest.fn(() => query(docs[0] ?? null)),
  findOne: jest.fn(() => query(docs[0] ?? null)),
  updateOne: jest.fn().mockResolvedValue({}),
  create: jest.fn(async (data: any) => ({ _id: 'new', ...data }))
});
const inventory = { findByIds: jest.fn().mockResolvedValue([]) };
const build = (docs: any[]): { svc: DampLabServices; model: any; sets: any } => {
  const model = serviceModel(docs);
  const sets = setModel();
  return { svc: new DampLabServices(model, inventory as any, sets), model, sets };
};
const ids = (params: any[]): string[] => params.map((p) => p.id);

describe('DampLabServices loaders return effective parameters (pin 12)', () => {
  it.each<[string, (s: DampLabServices) => Promise<any>]>([
    ['findAll', (s: DampLabServices): Promise<any> => s.findAll().then((r) => r[0])],
    ['findByIds', (s: DampLabServices): Promise<any> => s.findByIds(['op1' as any]).then((r) => r[0])],
    ['findOne', (s: DampLabServices): Promise<any> => s.findOne('op1')],
    ['findOneActive', (s: DampLabServices): Promise<any> => s.findOneActive('op1')]
  ])('%s', async (_name, load) => {
    const { svc } = build([op()]);
    const service: any = await load(svc);
    expect(ids(service.parameters)).toEqual(['cycles', 'buffer', 'volume']);
    expect(ids(service.ownParameters)).toEqual(['cycles']);
    expect(service.hiddenFromClients).toBe(false);
  });

  it('never queries sets for an operation that uses none', async () => {
    const { svc, sets } = build([op({ parameterSetIds: [] })]);
    const [service]: any[] = await svc.findAll();
    expect(ids(service.parameters)).toEqual(['cycles']);
    expect(sets.find).not.toHaveBeenCalled();
  });

  it('works when constructed without a set model (older specs)', async () => {
    const svc = new DampLabServices(serviceModel([op({ parameterSetIds: undefined })]), inventory as any);
    const [service]: any[] = await svc.findAll();
    expect(service.parameterSetIds).toEqual([]);
    expect(ids(service.ownParameters)).toEqual(['cycles']);
  });

  it('gives the placeholder every non-null field', () => {
    const { svc } = build([]);
    const stub: any = svc.placeholderForMissingService('gone');
    expect(stub).toMatchObject({ ownParameters: [], parameterSetIds: [], hiddenFromClients: false });
  });
});

describe('DampLabServices writes', () => {
  it('update strips set-derived parameters before storing (Review Focus 1)', async () => {
    const { svc, model } = build([op()]);
    await svc.update(op(), { parameters: [{ id: 'cycles' }, { id: 'buffer', fromParameterSetId: SET_A, fromParameterSetName: 'Buffers' }] } as any);
    expect(model.updateOne.mock.calls[0][1].parameters).toEqual([{ id: 'cycles' }]);
  });

  it('update returns the effective list', async () => {
    const { svc } = build([op()]);
    const updated: any = await svc.update(op(), { name: 'PCR 2' } as any);
    expect(ids(updated.parameters)).toEqual(['cycles', 'buffer', 'volume']);
  });

  it('refuses two sets carrying the same parameter id, naming the id and both sets (pin 6)', async () => {
    const { svc, model } = build([op()]);
    await expect(svc.update(op(), { parameterSetIds: [SET_A, SET_B] } as any)).rejects.toThrow('Parameter id "volume" is in both "Buffers" and "Cleanup".');
    expect(model.updateOne).not.toHaveBeenCalled();
    await expect(svc.create({ name: 'New', parameterSetIds: [SET_A, SET_B], allowedConnections: [] } as any)).rejects.toThrow('"volume"');
  });

  it('refuses an unknown set id', async () => {
    const { svc } = build([op()]);
    await expect(svc.update(op(), { parameterSetIds: ['cccccccccccccccccccccccc'] } as any)).rejects.toThrow('Parameter set cccccccccccccccccccccccc does not exist');
  });

  it('create strips set-derived parameters and stores parameterSetIds in the chosen order (pin 3)', async () => {
    const { svc, model } = build([]);
    await svc.create({ name: 'New', parameters: [{ id: 'x', fromParameterSetId: SET_A }], parameterSetIds: [SET_B], allowedConnections: [] } as any);
    expect(model.create.mock.calls[0][0]).toMatchObject({ parameters: [], parameterSetIds: [SET_B] });
  });
});
