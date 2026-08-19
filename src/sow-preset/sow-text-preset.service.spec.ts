import { SowTextPresetService, proseSectionDefinitions } from './sow-text-preset.service';
import { SOW_PROSE_DEFAULTS } from '../sow/sow-field-defaults';

/**
 * A stand-in for the Mongoose model, holding rows in an array. Enough of the
 * query surface for this service: find + sort, findOne + sort, insertMany,
 * create, findByIdAndUpdate, findByIdAndDelete, updateOne, estimatedDocumentCount.
 */
function fakeModel(seed: any[] = []): any {
  const rows: any[] = seed.map((r, i) => ({ _id: r._id ?? `id-${i + 1}`, ...r }));
  let nextId = rows.length + 1;

  const sortRows = (list: any[], spec: Record<string, number>): any[] =>
    [...list].sort((a, b) => {
      for (const [key, dir] of Object.entries(spec)) {
        const av = a[key];
        const bv = b[key];
        if (av === bv) continue;
        return (av > bv ? 1 : -1) * dir;
      }
      return 0;
    });

  const matches = (row: any, filter: any): boolean => Object.entries(filter ?? {}).every(([k, v]) => String(row[k]) === String(v));

  const model: any = {
    rows,
    estimatedDocumentCount: (): any => ({ exec: async (): Promise<number> => rows.length }),
    find: (filter: any = {}): any => {
      const found = rows.filter((r) => matches(r, filter));
      return { sort: (spec: any): any => ({ exec: async (): Promise<any[]> => sortRows(found, spec) }) };
    },
    findOne: (filter: any = {}): any => {
      const found = rows.filter((r) => matches(r, filter));
      return { sort: (spec: any): any => ({ exec: async (): Promise<any> => sortRows(found, spec)[0] ?? null }) };
    },
    insertMany: async (docs: any[]): Promise<any[]> => {
      for (const d of docs) rows.push({ _id: `id-${nextId++}`, ...d });
      return docs;
    },
    create: async (doc: any): Promise<any> => {
      const created = { _id: `id-${nextId++}`, ...doc };
      rows.push(created);
      return created;
    },
    findByIdAndUpdate: (id: string, patch: any): any => ({
      exec: async (): Promise<any> => {
        const row = rows.find((r) => r._id === id);
        if (!row) return null;
        Object.assign(row, patch);
        return row;
      }
    }),
    findByIdAndDelete: (id: string): any => ({
      exec: async (): Promise<any> => {
        const i = rows.findIndex((r) => r._id === id);
        if (i < 0) return null;
        return rows.splice(i, 1)[0];
      }
    }),
    updateOne: (filter: any, patch: any): any => ({
      exec: async (): Promise<void> => {
        const row = rows.find((r) => matches(r, filter));
        if (row) Object.assign(row, patch);
      }
    })
  };
  return model;
}

const author = { sub: 'sub-staff', name: 'tech' };

function block(sectionKey: string, name: string, order: number, text = 'text'): any {
  return { sectionKey, name, text, order, createdBy: 'x', createdByName: 'x', createdAt: new Date(), updatedBy: 'x', updatedByName: 'x', updatedAt: new Date() };
}

describe('seedIfEmpty', () => {
  it('turns the hardcoded prose into one Default block per section that has any', async () => {
    const model = fakeModel();
    const service = new SowTextPresetService(model);

    const count = await service.seedIfEmpty();

    const withProse = proseSectionDefinitions().filter(({ key }) => (SOW_PROSE_DEFAULTS[key] ?? '').trim() !== '');
    expect(count).toBe(withProse.length);
    expect(model.rows.every((r: any) => r.name === 'Default')).toBe(true);
    expect(model.rows.find((r: any) => r.sectionKey === 'invoiceProcedures').text).toBe(SOW_PROSE_DEFAULTS.invoiceProcedures);
  });

  it('leaves the three sections with no boilerplate empty, rather than seeding a blank Default', async () => {
    const model = fakeModel();
    await new SowTextPresetService(model).seedIfEmpty();

    for (const key of ['additionalInformation', 'clientProjectManager', 'clientCostCenter']) {
      expect(model.rows.filter((r: any) => r.sectionKey === key)).toHaveLength(0);
    }
  });

  it('is a no-op on the second run', async () => {
    const model = fakeModel();
    const service = new SowTextPresetService(model);

    await service.seedIfEmpty();
    const after = model.rows.length;

    expect(await service.seedIfEmpty()).toBe(0);
    expect(model.rows).toHaveLength(after);
  });

  /**
   * The guard is on the whole collection, not on the section. Otherwise emptying
   * a section would read as "never seeded" and the block staff deleted would come
   * back on the next restart.
   */
  it('does not resurrect a section whose last block was deleted', async () => {
    const model = fakeModel();
    const service = new SowTextPresetService(model);
    await service.seedIfEmpty();

    const target = model.rows.find((r: any) => r.sectionKey === 'billToAddress');
    await service.delete(target._id);

    await service.seedIfEmpty();
    expect(model.rows.filter((r: any) => r.sectionKey === 'billToAddress')).toHaveLength(0);
  });
});

describe('ordering', () => {
  it('appends new blocks below the default rather than taking its place', async () => {
    const model = fakeModel([block('invoiceProcedures', 'Default', 10)]);
    const service = new SowTextPresetService(model);

    await service.create('invoiceProcedures', 'Net 30', 'pay in 30', author);

    const list = await service.listForSection('invoiceProcedures');
    expect(list.map((p: any) => p.name)).toEqual(['Default', 'Net 30']);
  });

  it('renumbers by tens on reorder, so a block can be slotted between two later', async () => {
    const model = fakeModel([block('invoiceProcedures', 'A', 10), block('invoiceProcedures', 'B', 20), block('invoiceProcedures', 'C', 30)]);
    const service = new SowTextPresetService(model);

    const out = await service.reorder('invoiceProcedures', ['id-3', 'id-1', 'id-2']);

    expect(out.map((p: any) => p.name)).toEqual(['C', 'A', 'B']);
    expect(out.map((p: any) => p.order)).toEqual([10, 20, 30]);
  });

  it('keeps blocks the caller did not name, at the end', async () => {
    const model = fakeModel([block('invoiceProcedures', 'A', 10), block('invoiceProcedures', 'B', 20), block('invoiceProcedures', 'C', 30)]);
    const service = new SowTextPresetService(model);

    const out = await service.reorder('invoiceProcedures', ['id-2']);

    expect(out.map((p: any) => p.name)).toEqual(['B', 'A', 'C']);
  });

  it('ignores ids from another section', async () => {
    const model = fakeModel([block('invoiceProcedures', 'A', 10), block('completionCriteria', 'Other', 10)]);
    const service = new SowTextPresetService(model);

    const out = await service.reorder('invoiceProcedures', ['id-2', 'id-1']);

    expect(out.map((p: any) => p.name)).toEqual(['A']);
  });

  it('promotes the next block to default when the top one is deleted', async () => {
    const model = fakeModel([block('invoiceProcedures', 'A', 10), block('invoiceProcedures', 'B', 20)]);
    const service = new SowTextPresetService(model);

    await service.delete('id-1');

    expect((await service.defaultTextByKey()).invoiceProcedures).toBe('text');
    expect((await service.listForSection('invoiceProcedures'))[0].name).toBe('B');
  });
});

describe('defaultTextByKey', () => {
  it('answers with the top-ranked block of each section and nothing else', async () => {
    const model = fakeModel([block('invoiceProcedures', 'Default', 10, 'first'), block('invoiceProcedures', 'Alternate', 20, 'second'), block('completionCriteria', 'Default', 10, 'criteria')]);

    expect(await new SowTextPresetService(model).defaultTextByKey()).toEqual({
      invoiceProcedures: 'first',
      completionCriteria: 'criteria'
    });
  });

  it('omits a section with no blocks, so the calculator falls back to its hardcoded default', async () => {
    const map = await new SowTextPresetService(fakeModel()).defaultTextByKey();
    expect('invoiceProcedures' in map).toBe(false);
  });
});

describe('listSections', () => {
  it('lists every prose section, including the empty ones', async () => {
    const sections = await new SowTextPresetService(fakeModel()).listSections();

    expect(sections).toHaveLength(proseSectionDefinitions().length);
    expect(sections.every((s) => s.presetCount === 0)).toBe(true);
    expect(sections.find((s) => s.key === 'invoiceProcedures')?.label).toBe('Invoice Procedures');
  });

  it('reports the count, the default block and who last touched the section', async () => {
    const old = block('invoiceProcedures', 'Default', 10);
    old.updatedAt = new Date('2026-01-01T00:00:00Z');
    const recent = block('invoiceProcedures', 'Net 30', 20);
    recent.updatedAt = new Date('2026-06-01T00:00:00Z');
    recent.updatedByName = 'jane';

    const sections = await new SowTextPresetService(fakeModel([old, recent])).listSections();
    const row = sections.find((s) => s.key === 'invoiceProcedures');

    expect(row).toMatchObject({ presetCount: 2, defaultName: 'Default', updatedByName: 'jane' });
    expect(row?.updatedAt).toEqual(new Date('2026-06-01T00:00:00Z'));
  });
});

describe('update', () => {
  it('records who edited it, for the dropdown to show', async () => {
    const model = fakeModel([block('invoiceProcedures', 'Default', 10)]);
    const service = new SowTextPresetService(model);

    const updated: any = await service.update('id-1', { name: 'Renamed', text: 'new words' }, author);

    expect(updated).toMatchObject({ name: 'Renamed', text: 'new words', updatedBy: 'sub-staff', updatedByName: 'tech' });
  });

  it('leaves the text alone when only the name is sent', async () => {
    const model = fakeModel([block('invoiceProcedures', 'Default', 10, 'original')]);

    const updated: any = await new SowTextPresetService(model).update('id-1', { name: 'Renamed' }, author);

    expect(updated.text).toBe('original');
  });

  it('rejects an unknown id rather than silently doing nothing', async () => {
    await expect(new SowTextPresetService(fakeModel()).update('nope', { name: 'x' }, author)).rejects.toThrow(/not found/);
  });
});

/**
 * The "New text block preset" button creates a block with no text yet — staff
 * name it and type into it afterwards. Mongoose treats '' as a missing value, so
 * the text field must not be `required`, or that button fails outright.
 */
describe('create', () => {
  it('accepts a block with no text yet', async () => {
    const model = fakeModel();
    const created: any = await new SowTextPresetService(model).create('invoiceProcedures', 'New text block', '', author);

    expect(created).toMatchObject({ sectionKey: 'invoiceProcedures', name: 'New text block', text: '', order: 10 });
  });

  it('names an unnamed block rather than storing a blank heading', async () => {
    const model = fakeModel();
    const created: any = await new SowTextPresetService(model).create('invoiceProcedures', '   ', 'words', author);

    expect(created.name).toBe('Untitled block');
  });

  it('records the author on both the created and updated fields', async () => {
    const model = fakeModel();
    const created: any = await new SowTextPresetService(model).create('invoiceProcedures', 'A', 'words', author);

    expect(created).toMatchObject({ createdBy: 'sub-staff', createdByName: 'tech', updatedBy: 'sub-staff', updatedByName: 'tech' });
  });
});
