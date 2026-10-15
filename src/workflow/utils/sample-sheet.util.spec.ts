import { JobState } from '../../job/job.model';
import {
  expectedColumns,
  fileParameterIds,
  findTableParam,
  flattenValues,
  foreignFileKey,
  holdsStorageKey,
  isTableParam,
  isTableType,
  keyBelongsToUploader,
  sampleCountFromValue,
  sampleSheetKeyOf,
  sampleSheetReplaceBlockedReason,
  SERVER_COUNTED,
  serverCountedRows,
  tableIsSetUp,
  templateKeyOf
} from './sample-sheet.util';

describe('sample-sheet.util', () => {
  describe('sampleCountFromValue', () => {
    it('reads the count off the stored JSON string and off a parsed object', () => {
      expect(sampleCountFromValue(JSON.stringify({ filename: 'a.xlsx', key: 'k', sampleCount: 12 }))).toBe(12);
      expect(sampleCountFromValue({ filename: 'a.xlsx', key: 'k', sampleCount: 0, url: 'u' })).toBe(0);
    });

    it('is undefined for no file, junk, or a count that is not a non-negative number', () => {
      expect(sampleCountFromValue(null)).toBeUndefined();
      expect(sampleCountFromValue('')).toBeUndefined();
      expect(sampleCountFromValue('nope')).toBeUndefined();
      expect(sampleCountFromValue({ filename: 'a.xlsx' })).toBeUndefined();
      expect(sampleCountFromValue({ filename: 'a.xlsx', sampleCount: '5' })).toBeUndefined();
      expect(sampleCountFromValue({ filename: 'a.xlsx', sampleCount: -1 })).toBeUndefined();
    });
  });

  describe('findTableParam', () => {
    const parameters = [
      { id: 'notes', type: 'string' },
      { id: 'samples', type: 'sampleSheet', templateFile: { key: 'sample-sheet-templates/abc-blank.xlsx' } },
      { id: 'other', type: 'file' }
    ];

    it('finds only a parameter of the sampleSheet type', () => {
      expect(findTableParam(parameters, 'samples')?.id).toBe('samples');
      expect(findTableParam(parameters, 'other')).toBeNull();
      expect(findTableParam(parameters, 'missing')).toBeNull();
    });

    it('tolerates parameters that are not an array', () => {
      expect(findTableParam(undefined, 'samples')).toBeNull();
      expect(findTableParam({ samples: {} }, 'samples')).toBeNull();
    });
  });

  describe('templateKeyOf', () => {
    it('returns the key only when it sits under the template prefix', () => {
      expect(templateKeyOf({ id: 'a', type: 'sampleSheet', templateFile: { key: 'sample-sheet-templates/x.xlsx' } })).toBe('sample-sheet-templates/x.xlsx');
      expect(templateKeyOf({ id: 'a', type: 'sampleSheet', templateFile: { key: 'workflow-parameters/u/x.xlsx' } })).toBeNull();
      expect(templateKeyOf({ id: 'a', type: 'sampleSheet' })).toBeNull();
      expect(templateKeyOf(null)).toBeNull();
    });
  });

  describe('keyBelongsToUploader', () => {
    it('accepts a key under the caller’s own upload prefix and nothing else', () => {
      expect(keyBelongsToUploader('workflow-parameters/user-1/abc-samples.xlsx', 'user-1')).toBe(true);
      expect(keyBelongsToUploader('workflow-parameters/user-2/abc-samples.xlsx', 'user-1')).toBe(false);
      expect(keyBelongsToUploader('workflow-parameters/user-1/../user-2/abc.xlsx', 'user-1')).toBe(false);
      expect(keyBelongsToUploader('sample-sheet-templates/abc.xlsx', 'user-1')).toBe(false);
      expect(keyBelongsToUploader('workflow-parameters/user-10/abc.xlsx', 'user-1')).toBe(false);
    });
  });

  describe('sampleSheetReplaceBlockedReason', () => {
    it('allows replacement in every state the job is still alive in', () => {
      for (const state of [JobState.CREATING, JobState.SUBMITTED, JobState.CHANGES_REQUESTED, JobState.ACCEPTED, JobState.WAITING_FOR_SOW, JobState.QUEUED, JobState.IN_PROGRESS, JobState.COMPLETE]) {
        expect(sampleSheetReplaceBlockedReason({ state })).toBeNull();
      }
    });

    it('refuses once the job is finished with', () => {
      expect(sampleSheetReplaceBlockedReason({ state: JobState.CLOSED })).toMatch(/closed/);
      expect(sampleSheetReplaceBlockedReason({ state: JobState.CANCELLED })).toMatch(/cancelled/);
      expect(sampleSheetReplaceBlockedReason({ state: JobState.REJECTED })).toMatch(/not accepted/);
    });
  });
});

describe('sampleSheetKeyOf', () => {
  it('reads the key from a stored JSON string or a round-tripped object', () => {
    expect(sampleSheetKeyOf(JSON.stringify({ filename: 'a.xlsx', key: 'workflow-parameters/u/1' }))).toBe('workflow-parameters/u/1');
    expect(sampleSheetKeyOf({ filename: 'a.xlsx', key: 'workflow-parameters/u/1', url: 'https://x' })).toBe('workflow-parameters/u/1');
  });
  it('is undefined for no file, no key, or junk', () => {
    for (const v of [null, undefined, '', 'not json', JSON.stringify({ filename: 'a.xlsx', notUploaded: true }), 42]) expect(sampleSheetKeyOf(v)).toBeUndefined();
  });

  describe('one Table type (rule 1)', () => {
    it('reads both stored strings as a Table and nothing else', () => {
      expect(isTableType('table')).toBe(true);
      expect(isTableType('sampleSheet')).toBe(true);
      expect(isTableType('file')).toBe(false);
      expect(isTableType(undefined)).toBe(false);
      expect(isTableParam({ id: 'a', type: 'table' })).toBe(true);
      expect(isTableParam({ id: 'a', type: 'sampleSheet' })).toBe(true);
      expect(isTableParam({ type: 'table' })).toBe(false);
    });

    it('finds a parameter stored under either string', () => {
      const parameters = [
        { id: 'old', type: 'sampleSheet' },
        { id: 'new', type: 'table' },
        { id: 'f', type: 'file' }
      ];
      expect(findTableParam(parameters, 'old')?.id).toBe('old');
      expect(findTableParam(parameters, 'new')?.id).toBe('new');
      expect(findTableParam(parameters, 'f')).toBeNull();
    });

    it('lists file and Table parameters as the ids whose values are storage keys', () => {
      expect(fileParameterIds([{ id: 'f', type: 'file' }, { id: 's', type: 'sampleSheet' }, { id: 't', type: 'table' }, { id: 'n', type: 'number' }, { type: 'table' }, null])).toEqual([
        'f',
        's',
        't'
      ]);
      expect(fileParameterIds(undefined)).toEqual([]);
    });
  });

  describe('expectedColumns / tableIsSetUp', () => {
    it('is the trimmed, non-blank headers of tableData.columns, in order', () => {
      const param = {
        id: 't',
        type: 'table',
        tableData: { columns: [{ header: ' Inducer ', field: 'inducer' }, { header: '' }, { field: 'x' }, { header: 'Location', field: 'location' }], rows: [{ id: 1 }] }
      };
      expect(expectedColumns(param)).toEqual(['Inducer', 'Location']);
    });

    it('is empty for no tableData, a non-list, or junk', () => {
      expect(expectedColumns({ id: 't', type: 'table' })).toEqual([]);
      expect(expectedColumns({ id: 't', type: 'table', tableData: null })).toEqual([]);
      expect(expectedColumns({ id: 't', type: 'table', tableData: { columns: 'A; B' } })).toEqual([]);
      expect(expectedColumns(null)).toEqual([]);
    });

    it('is set up with a column or with a staff template, and not otherwise', () => {
      expect(tableIsSetUp({ id: 't', type: 'table', tableData: { columns: [{ header: 'A', field: 'a' }] } })).toBe(true);
      expect(tableIsSetUp({ id: 't', type: 'sampleSheet', templateFile: { key: 'sample-sheet-templates/a.xlsx' } })).toBe(true);
      expect(tableIsSetUp({ id: 't', type: 'sampleSheet', templateFile: { key: 'workflow-parameters/u/a.xlsx' } })).toBe(false);
      expect(tableIsSetUp({ id: 't', type: 'table', tableData: { columns: [], rows: [{ a: 1 }] } })).toBe(false);
    });
  });

  describe('serverCountedRows (R2d)', () => {
    const counted = (sampleCount: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      filename: 'a.csv',
      key: 'workflow-parameters/u/a.csv',
      sampleCount,
      countedBy: 'server',
      ...extra
    });

    it('reads the row count of a value the server marked, as a stored string or a parsed object', () => {
      expect(SERVER_COUNTED).toBe('server');
      expect(serverCountedRows(JSON.stringify(counted(12)))).toBe(12);
      expect(serverCountedRows({ ...counted(3), url: 'https://s3/x' })).toBe(3);
      expect(serverCountedRows(JSON.stringify(counted(0)))).toBe(0);
    });

    it('sums the marked elements of an array', () => {
      expect(serverCountedRows([JSON.stringify(counted(12)), JSON.stringify(counted(3)), ''])).toBe(15);
    });

    it('is undefined for anything the server did not mark — every shape stored before table-upload', () => {
      const unmarked = { filename: 'a.csv', key: 'workflow-parameters/u/a.csv', sampleCount: 12 };
      for (const value of [undefined, null, '', 'legacy', 3, true, [], [''], JSON.stringify(unmarked), unmarked, [JSON.stringify(unmarked)], JSON.stringify([{ id: 1 }]), { rows: [] }]) {
        expect(serverCountedRows(value)).toBeUndefined();
      }
    });

    it('does not trust a mark without a usable count, or a different mark', () => {
      expect(serverCountedRows(JSON.stringify(counted('12')))).toBeUndefined();
      expect(serverCountedRows(JSON.stringify(counted(-1)))).toBeUndefined();
      expect(serverCountedRows(JSON.stringify(counted(12, { countedBy: 'client' })))).toBeUndefined();
    });
  });

  describe('holdsStorageKey', () => {
    it('is true only when a value, or an element of it, is a file record with a key', () => {
      expect(holdsStorageKey(JSON.stringify({ filename: 'a.csv', key: 'workflow-parameters/u/a.csv' }))).toBe(true);
      expect(holdsStorageKey(['', { key: 'workflow-parameters/u/a.csv' }])).toBe(true);
      for (const value of [undefined, null, '', 'legacy', 3, true, [], [''], { rows: [] }, JSON.stringify({ filename: 'a.csv', notUploaded: true })]) expect(holdsStorageKey(value)).toBe(false);
    });
  });

  describe('flattenValues', () => {
    it('flattens nested arrays and wraps a scalar', () => {
      expect(flattenValues([1, [2, [3]], 4])).toEqual([1, 2, 3, 4]);
      expect(flattenValues('a')).toEqual(['a']);
      expect(flattenValues(undefined)).toEqual([undefined]);
    });
  });

  describe('foreignFileKey (R1)', () => {
    const parameters = [
      { id: 'doc', type: 'file' },
      { id: 'sheet', type: 'sampleSheet' },
      { id: 'plate', type: 'table' },
      { id: 'note', type: 'string' }
    ];
    const value = (key: string): string => JSON.stringify({ filename: 'f', key });
    const mine = 'workflow-parameters/me/a.csv';
    const theirs = 'workflow-parameters/them/a.csv';

    it('is null when every file and Table key is under the caller’s own prefix', () => {
      const formData = [
        { id: 'doc', value: value(mine) },
        { id: 'sheet', value: value(mine) },
        { id: 'plate', value: [value(mine), { key: mine }] }
      ];
      expect(foreignFileKey(parameters, formData, 'me')).toBeNull();
    });

    it('names the first key that is not — on a file parameter, a sample sheet or a Table; as a string, an object or an array element', () => {
      expect(foreignFileKey(parameters, [{ id: 'doc', value: value(theirs) }], 'me')).toBe(theirs);
      expect(foreignFileKey(parameters, [{ id: 'sheet', value: { key: theirs } }], 'me')).toBe(theirs);
      expect(foreignFileKey(parameters, [{ id: 'plate', value: [value(mine), value(theirs)] }], 'me')).toBe(theirs);
    });

    it('treats any key outside the caller’s folder as foreign: another storage area, a parent-directory segment, a look-alike prefix', () => {
      for (const key of ['sample-sheet-templates/blank.xlsx', 'job-attachments/j/x.pdf', 'workflow-parameters/me/../them/a.csv', 'workflow-parameters/me-too/a.csv']) {
        expect(foreignFileKey(parameters, [{ id: 'doc', value: value(key) }], 'me')).toBe(key);
      }
    });

    it('ignores blanks, values with no key, and parameters that hold no file', () => {
      const formData = [
        { id: 'doc', value: null },
        { id: 'sheet', value: '' },
        { id: 'plate', value: JSON.stringify({ filename: 'f', notUploaded: true }) },
        { id: 'doc', value: 'not json' },
        { id: 'note', value: value(theirs) },
        { id: 'gone', value: value(theirs) }
      ];
      expect(foreignFileKey(parameters, formData, 'me')).toBeNull();
    });

    it('with no caller sub, only the shared anonymous folder passes — the folder such a caller’s uploads are minted under', () => {
      expect(foreignFileKey(parameters, [{ id: 'doc', value: value(mine) }], undefined)).toBe(mine);
      expect(foreignFileKey(parameters, [{ id: 'doc', value: value('workflow-parameters/anonymous/a.csv') }], undefined)).toBeNull();
    });
  });
});
