import { BadRequestException } from '@nestjs/common';
import { ObjectTooLargeError } from '../services/workflow-parameter-files.service';
import { countNewTableAnswers, withStoredTableAnswers } from './table-answers';

const columns = [
  { header: 'Inducer', field: 'inducer' },
  { header: 'Concentration', field: 'concentration' }
];
const parameters = [
  { id: 'plate', name: 'Plate map', type: 'table', tableData: { columns } },
  { id: 'legacy', name: 'Samples', type: 'sampleSheet', templateFile: { key: 'sample-sheet-templates/blank.xlsx' } },
  { id: 'bare', name: 'Unset', type: 'table' },
  { id: 'doc', name: 'Protocol', type: 'file' },
  { id: 'note', name: 'Note', type: 'string' }
];
const OWN = 'workflow-parameters/me/new.csv';
const OLD = 'workflow-parameters/owner/old.csv';
const sent = (key: string, sampleCount = 999): string => JSON.stringify({ filename: 'plate.csv', key, contentType: 'text/csv', size: 1, sampleCount, uploadedAt: '2026-10-01T00:00:00.000Z' });
const storedOld = JSON.stringify({ filename: 'old.csv', key: OLD, contentType: 'text/csv', size: 40, sampleCount: 7, uploadedAt: '2026-09-01T00:00:00.000Z' });
const good = Buffer.from('Concentration,Inducer,Notes\n1,IPTG,\n2,aTc,x\n,,\n3,,\n', 'utf8');
const reader = (buffer: Buffer = good): jest.Mock => jest.fn(async () => buffer);
const run = (formData: any[], readObject: jest.Mock, stored?: unknown): Promise<any[]> =>
  countNewTableAnswers({ parameters, formData, stored, operation: 'Induction', readObject, now: () => new Date('2026-10-08T12:00:00.000Z') });

describe('countNewTableAnswers — a new key (rule 22)', () => {
  it('fetches the object, checks the header and stores the server’s own count, whatever the client sent', async () => {
    const readObject = reader();
    const out = await run(
      [
        { id: 'plate', value: sent(OWN, 999) },
        { id: 'note', value: 'hello' }
      ],
      readObject
    );
    expect(readObject).toHaveBeenCalledTimes(1);
    expect(readObject).toHaveBeenCalledWith(OWN);
    expect(JSON.parse(out[0].value)).toEqual({
      filename: 'plate.csv',
      key: OWN,
      contentType: 'text/csv',
      size: good.length,
      sampleCount: 3,
      uploadedAt: '2026-10-01T00:00:00.000Z',
      countedBy: 'server'
    });
    expect(out[1]).toEqual({ id: 'note', value: 'hello' });
  });

  it('stores only its own seven fields: nothing else the client put in the value survives', async () => {
    const value = JSON.stringify({ filename: 'p.csv', key: OWN, contentType: 'text/csv', size: 1, sampleCount: 1, url: 'https://evil', extra: true });
    const out = await run([{ id: 'plate', value }], reader());
    expect(Object.keys(JSON.parse(out[0].value)).sort()).toEqual(['contentType', 'countedBy', 'filename', 'key', 'sampleCount', 'size', 'uploadedAt']);
    expect(JSON.parse(out[0].value).uploadedAt).toBe('2026-10-08T12:00:00.000Z');
  });

  // R2d: the mark is the server's. A client that sends it gets the server's count, not its own.
  it('marks what it counted, and a mark the client sent buys nothing', async () => {
    const forged = JSON.stringify({ filename: 'p.csv', key: OWN, contentType: 'text/csv', size: 1, sampleCount: 5000, countedBy: 'server' });
    const out = await run([{ id: 'plate', value: forged }], reader());
    expect(JSON.parse(out[0].value)).toMatchObject({ sampleCount: 3, countedBy: 'server' });
  });

  it('writes a value stored before the server counted back without the mark: it keeps the bill it had', async () => {
    const out = await run([{ id: 'plate', value: sent(OLD, 1) }], reader(), [{ id: 'plate', value: storedOld }]);
    expect(out[0].value).toBe(storedOld);
    expect(JSON.parse(out[0].value as string)).not.toHaveProperty('countedBy');
  });

  it('accepts the object form of a value (the job editor sends parsed objects)', async () => {
    const out = await run([{ id: 'plate', value: { filename: 'p.csv', key: OWN, contentType: 'text/csv', size: 1, sampleCount: 50 } }], reader());
    expect(JSON.parse(out[0].value).sampleCount).toBe(3);
  });

  it('refuses a file missing a column, naming the parameter, the operation and every missing column', async () => {
    const call = run([{ id: 'plate', value: sent(OWN) }], reader(Buffer.from('Inducer\nIPTG\n')));
    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(run([{ id: 'plate', value: sent(OWN) }], reader(Buffer.from('Inducer\nIPTG\n')))).rejects.toThrow('“Plate map” on “Induction”: This file is missing the columns: Concentration.');
  });

  it('has no column check for a legacy sample sheet with only a staff template (rule 20)', async () => {
    const out = await run([{ id: 'legacy', value: sent(OWN) }], reader(Buffer.from('Anything\na\nb\n')));
    expect(JSON.parse(out[0].value).sampleCount).toBe(2);
  });

  it('refuses a new file for a Table with no columns and no staff template, without fetching', async () => {
    const readObject = reader();
    await expect(run([{ id: 'bare', value: sent(OWN) }], readObject)).rejects.toThrow('“Unset” on “Induction”: This table has not been set up yet.');
    expect(readObject).not.toHaveBeenCalled();
  });

  // Review Focus 5.
  it('refuses, never accepts uncounted, when the object cannot be fetched (rule 26)', async () => {
    const failing = jest.fn(async () => {
      throw new Error('Workflow parameter file storage is not configured on the server.');
    });
    await expect(run([{ id: 'plate', value: sent(OWN) }], failing)).rejects.toBeInstanceOf(BadRequestException);
    await expect(run([{ id: 'plate', value: sent(OWN) }], failing)).rejects.toThrow('“Plate map” on “Induction”: This file could not be read; upload it again.');
  });

  it('refuses an object over the cap with the size message', async () => {
    const tooBig = jest.fn(async () => {
      throw new ObjectTooLargeError();
    });
    await expect(run([{ id: 'plate', value: sent(OWN) }], tooBig)).rejects.toThrow('“Plate map” on “Induction”: This file must be smaller than 10 MB.');
  });

  it('never fetches a key outside the upload prefix, or one with a parent-directory segment', async () => {
    const readObject = reader();
    for (const key of ['sample-sheet-templates/blank.xlsx', 'job-attachments/j/secret.pdf', 'workflow-parameters/me/../other/x.csv']) {
      await expect(run([{ id: 'plate', value: sent(key) }], readObject)).rejects.toThrow('This file could not be read; upload it again.');
    }
    expect(readObject).not.toHaveBeenCalled();
  });

  it('counts a key whose file name contains `..` (not a path segment)', async () => {
    const key = 'workflow-parameters/me/uuid-a..b.csv';
    const readObject = reader();
    const out = await run([{ id: 'plate', value: sent(key) }], readObject);
    expect(readObject).toHaveBeenCalledWith(key);
    expect(JSON.parse(out[0].value).sampleCount).toBe(3);
  });

  it('refuses a non-empty value with no storage key (a file that was never stored)', async () => {
    const readObject = reader();
    await expect(run([{ id: 'plate', value: JSON.stringify({ filename: 'p.csv', notUploaded: true, sampleCount: 4 }) }], readObject)).rejects.toThrow('This file could not be read; upload it again.');
    await expect(run([{ id: 'plate', value: 'not json' }], readObject)).rejects.toBeInstanceOf(BadRequestException);
    expect(readObject).not.toHaveBeenCalled();
  });

  it('leaves no file and the old empty answer exactly as they are', async () => {
    const readObject = reader();
    const formData = [
      { id: 'plate', value: null },
      { id: 'legacy', value: '' }
    ];
    await expect(run(formData, readObject)).resolves.toEqual(formData);
    expect(readObject).not.toHaveBeenCalled();
  });

  it('does not touch file parameters or anything that is not a Table', async () => {
    const readObject = reader();
    const formData = [
      { id: 'doc', value: sent('workflow-parameters/other/x.pdf') },
      { id: 'note', value: sent(OWN) },
      { id: 'gone', value: sent(OWN) }
    ];
    await expect(run(formData, readObject)).resolves.toEqual(formData);
    expect(readObject).not.toHaveBeenCalled();
  });

  it('counts each element when a Table answer arrives as an array', async () => {
    const out = await run([{ id: 'plate', value: [sent(OWN), sent('workflow-parameters/me/second.csv')] }], reader());
    expect(out[0].value.map((v: string) => JSON.parse(v).sampleCount)).toEqual([3, 3]);
  });
});

describe('a key already stored on the node for that parameter (rules 23, 24)', () => {
  const stored = [
    { id: 'plate', value: storedOld },
    { id: 'note', value: 'old note' }
  ];

  it('is written back exactly as stored — stored count included — and is not fetched, checked or counted', async () => {
    const readObject = reader(Buffer.from('Wrong,Columns\n'));
    const out = await run([{ id: 'plate', value: sent(OLD, 1) }], readObject, stored);
    expect(out[0].value).toBe(storedOld);
    expect(readObject).not.toHaveBeenCalled();
  });

  // Review Focus 3.
  it('is written back as stored when the editor returns it as a parsed object with a presigned url', async () => {
    const roundTripped = { ...JSON.parse(storedOld), url: 'https://s3/presigned', sampleCount: 1 };
    const out = await run([{ id: 'plate', value: roundTripped }], reader(), stored);
    expect(out[0].value).toBe(storedOld);
  });

  it('reads stored answers kept as a legacy object keyed by id', async () => {
    const out = await run([{ id: 'plate', value: sent(OLD, 1) }], reader(), { plate: storedOld });
    expect(out[0].value).toBe(storedOld);
  });

  it('a key stored on a different parameter of the node is a new key for this one', async () => {
    const readObject = reader();
    await run([{ id: 'plate', value: sent(OLD, 1) }], readObject, [{ id: 'legacy', value: storedOld }]);
    expect(readObject).toHaveBeenCalledWith(OLD);
  });

  it('keeps a stored value that has no key when it comes back unchanged', async () => {
    const odd = JSON.stringify({ filename: 'p.csv', notUploaded: true });
    await expect(run([{ id: 'plate', value: odd }], reader(), [{ id: 'plate', value: odd }])).resolves.toEqual([{ id: 'plate', value: odd }]);
  });

  it('withStoredTableAnswers does the write-back alone, with no reader at all', () => {
    const formData = [
      { id: 'plate', value: sent(OLD, 1) },
      { id: 'legacy', value: sent(OWN, 5) },
      { id: 'note', value: 'n' }
    ];
    const out = withStoredTableAnswers(parameters, formData, stored);
    expect(out[0].value).toBe(storedOld);
    expect(out[1]).toEqual(formData[1]);
    expect(out[2]).toEqual(formData[2]);
    expect(withStoredTableAnswers(parameters, formData, undefined)).toEqual(formData);
  });
});
