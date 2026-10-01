import { migrateInventoryTypes } from './migrate-inventory-types';

const db = (documents: any[]): any => ({
  collection: () => ({
    find: () => documents.map((document) => ({ ...document })),
    updateOne: async (filter: any, update: any): Promise<void> => {
      const document = documents.find((candidate) => candidate._id === filter._id);
      if (document) Object.assign(document, update.$set);
    }
  })
});

describe('migrateInventoryTypes', () => {
  const items = (): any[] => [
    { _id: 'a', name: 'Opentrons', type: 'ROBOT' },
    { _id: 'b', name: 'Plate reader', type: 'INSTRUMENT' },
    { _id: 'c', name: 'Hood 1', type: 'HOOD' },
    { _id: 'd', name: '-80', type: 'Freezer' },
    { _id: 'e', name: 'Odd', type: 'constructor' },
    { _id: 'f', name: 'Untyped' }
  ];

  it('maps only the legacy enum values and leaves every free-string type alone', async () => {
    const documents = items();
    const report = await migrateInventoryTypes(db(documents), { log: () => undefined });
    expect(documents.map((item) => item.type)).toEqual(['EQUIPMENT', 'EQUIPMENT', 'HOOD', 'Freezer', 'constructor', undefined]);
    expect(report).toMatchObject({ scanned: 6, migrated: 2, skipped: 4, failed: [] });
    expect(report.leftAlone).toEqual([
      { id: 'd', type: 'Freezer' },
      { id: 'e', type: 'constructor' }
    ]);
  });

  it('changes nothing the second time', async () => {
    const documents = items();
    await migrateInventoryTypes(db(documents), { log: () => undefined });
    const second = await migrateInventoryTypes(db(documents), { log: () => undefined });
    expect(second.migrated).toBe(0);
  });

  it('writes nothing on a dry run', async () => {
    const documents = items();
    const report = await migrateInventoryTypes(db(documents), { dryRun: true, log: () => undefined });
    expect(documents[0].type).toBe('ROBOT');
    expect(report.migrated).toBe(2);
  });
});
