import { BadRequestException } from '@nestjs/common';
import { DampLabServices } from './damplab-services.services';

/** A Mongoose query stand-in: awaitable, and `.exec()`-able. */
const query = <T>(value: T): any => {
  const p: any = Promise.resolve(value);
  p.exec = (): Promise<T> => Promise.resolve(value);
  return p;
};

const op = (): any => ({ _id: 'op1', name: 'PCR', parameters: [], parameterSetIds: [], allowedConnections: [], protocolIds: [], deliverables: [] });

const build = (): { svc: DampLabServices; model: any } => {
  const model: any = {
    find: jest.fn(() => query([op()])),
    findById: jest.fn(() => query(op())),
    findOne: jest.fn(() => query(op())),
    updateOne: jest.fn().mockResolvedValue({}),
    create: jest.fn(async (data: any) => ({ _id: 'new', ...data }))
  };
  const inventory = { findByIds: jest.fn().mockResolvedValue([]) };
  const sets = { find: jest.fn(() => query([])) };
  return { svc: new DampLabServices(model, inventory as any, sets as any), model };
};

describe('DampLabServices refuses a bad parameter definition', () => {
  it('update: an unparseable validation is refused before anything is written', async () => {
    const { svc, model } = build();
    const changes: any = { parameters: [{ id: 'n', name: 'Cycles', type: 'number', validation: '>0 || <5' }] };
    await expect(svc.update(op(), changes)).rejects.toThrow(BadRequestException);
    await expect(svc.update(op(), changes)).rejects.toThrow('Parameter “Cycles”: “||” is not supported — join rules with &&.');
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('update: checkboxes on a single-value dropdown is refused', async () => {
    const { svc } = build();
    const changes: any = { parameters: [{ id: 'd', name: 'Type', type: 'dropdown', allowMultipleValues: false, display: 'checkboxes' }] };
    await expect(svc.update(op(), changes)).rejects.toThrow('Parameter “Type”: “checkboxes” needs a dropdown that allows multiple values.');
  });

  it('update: a good definition is written', async () => {
    const { svc, model } = build();
    const parameters = [
      { id: 'n', name: 'Cycles', type: 'number', validation: '>0 && integer' },
      { id: 'd', name: 'Type', type: 'dropdown', allowMultipleValues: true, display: 'checkboxes', options: [{ id: 'o', name: 'Other' }] }
    ];
    await svc.update(op(), { parameters } as any);
    expect(model.updateOne).toHaveBeenCalledWith({ _id: 'op1' }, { parameters });
  });

  it('update: a change that does not mention parameters is not checked', async () => {
    const { svc, model } = build();
    await svc.update(op(), { name: 'PCR 2' } as any);
    expect(model.updateOne).toHaveBeenCalledWith({ _id: 'op1' }, { name: 'PCR 2' });
  });

  it('create: an unparseable validation is refused', async () => {
    const { svc, model } = build();
    const input: any = { name: 'New', parameters: [{ id: 'n', name: 'Cycles', type: 'number', validation: 'positive' }] };
    await expect(svc.create(input)).rejects.toThrow('Parameter “Cycles”: “positive” is not a rule. Use >n, >=n, <n, <=n or integer.');
    expect(model.create).not.toHaveBeenCalled();
  });
});

describe('DampLabServices refuses a bad “show only if” (show-only-if rule 34)', () => {
  const controller = { id: 'sample', name: 'Sample Type', type: 'dropdown', options: [{ id: 'bact', name: 'Bacteria' }] };

  it('update: a malformed tree is refused before anything is written', async () => {
    const { svc, model } = build();
    const changes: any = { parameters: [controller, { id: 'k', name: 'Kit', type: 'string', showIf: { parameterId: 'sample', op: 'matches', value: 'x' } }] };
    await expect(svc.update(op(), changes)).rejects.toThrow('Parameter “Kit”: “Show only if” is not a valid condition (unknown operator “matches”).');
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('update: a loop between two of the operation’s own parameters is refused', async () => {
    const { svc } = build();
    const a = { id: 'a', name: 'A', type: 'string', showIf: { parameterId: 'b', op: 'eq', value: 'x' } };
    const b = { id: 'b', name: 'B', type: 'string', showIf: { parameterId: 'a', op: 'eq', value: 'x' } };
    await expect(svc.update(op(), { parameters: [a, b] } as any)).rejects.toThrow('Parameter “A”: “Show only if” forms a loop with another parameter’s condition.');
  });

  it('update: a well-formed condition is stored as sent, and a reference into a set is not checked', async () => {
    const { svc, model } = build();
    const parameters = [
      controller,
      { id: 'k', name: 'Kit', type: 'string', showIf: { parameterId: 'sample', op: 'eq', optionIds: ['bact'] } },
      { id: 'v', name: 'Volume', type: 'number', showIf: { parameterId: 'anything', parameterSetId: 'set-that-may-not-exist', op: 'gt', value: 3 } }
    ];
    await svc.update(op(), { parameters } as any);
    expect(model.updateOne).toHaveBeenCalledWith({ _id: 'op1' }, { parameters });
  });

  it('create: a parameter that refers to itself is refused', async () => {
    const { svc, model } = build();
    const input: any = { name: 'New', parameters: [{ id: 'k', name: 'Kit', type: 'string', showIf: { parameterId: 'k', op: 'eq', value: 'x' } }] };
    await expect(svc.create(input)).rejects.toThrow('Parameter “Kit”: “Show only if” cannot refer to the parameter itself.');
    expect(model.create).not.toHaveBeenCalled();
  });
});

describe('DampLabServices refuses a Table with no columns and no staff template (table-upload rule 12)', () => {
  const bare = { id: 'plate', name: 'Plate map', type: 'table' };
  const MESSAGE = 'Parameter “Plate map”: a Table needs at least one column.';

  it('update: a new unconfigured Table is refused before anything is written', async () => {
    const { svc, model } = build();
    await expect(svc.update(op(), { parameters: [bare] } as any)).rejects.toThrow(BadRequestException);
    await expect(svc.update(op(), { parameters: [bare] } as any)).rejects.toThrow(MESSAGE);
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('update: one already stored that way still saves when the write does not change its type, columns or template', async () => {
    const { svc, model } = build();
    const stored = { ...op(), parameters: [bare], ownParameters: [bare] };
    const parameters = [
      { ...bare, description: 'now described' },
      { id: 'n', name: 'Cycles', type: 'number' }
    ];
    await svc.update(stored, { parameters } as any);
    expect(model.updateOne).toHaveBeenCalledWith({ _id: 'op1' }, { parameters });
  });

  it('update: compares against the operation’s own parameters, not a same-id parameter that came from a set', async () => {
    const { svc } = build();
    const fromSet = { ...bare, fromParameterSetId: 'set1' };
    const stored = { ...op(), parameters: [fromSet], ownParameters: [] };
    await expect(svc.update(stored, { parameters: [bare] } as any)).rejects.toThrow(MESSAGE);
  });

  it('update: removing the last column is refused', async () => {
    const { svc } = build();
    const configured = { ...bare, tableData: { columns: [{ header: 'A', field: 'a' }] } };
    const stored = { ...op(), parameters: [configured], ownParameters: [configured] };
    await expect(svc.update(stored, { parameters: [{ ...bare, tableData: { columns: [] } }] } as any)).rejects.toThrow(MESSAGE);
  });

  it('update: a Table with columns, and a legacy sample sheet with a staff template, are written', async () => {
    const { svc, model } = build();
    const parameters = [
      { ...bare, tableData: { columns: [{ header: 'Inducer', field: 'inducer' }] } },
      { id: 'sheet', name: 'Samples', type: 'sampleSheet', templateFile: { key: 'sample-sheet-templates/a.xlsx' } }
    ];
    await svc.update(op(), { parameters } as any);
    expect(model.updateOne).toHaveBeenCalledWith({ _id: 'op1' }, { parameters });
  });

  it('create: an unconfigured Table is refused', async () => {
    const { svc, model } = build();
    await expect(svc.create({ name: 'New', parameters: [bare] } as any)).rejects.toThrow(MESSAGE);
    expect(model.create).not.toHaveBeenCalled();
  });
});
