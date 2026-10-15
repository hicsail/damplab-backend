import * as ExcelJS from 'exceljs';
import * as JSZip from 'jszip';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  checkTableFile,
  missingColumns,
  missingColumnsMessage,
  readTableFile,
  readTableRows,
  TABLE_FILE_MAX_BYTES,
  TABLE_FILE_MAX_INFLATED_BYTES,
  TABLE_FILE_NO_SHEETS_MESSAGE,
  TABLE_FILE_NOT_FETCHED_MESSAGE,
  TABLE_FILE_TOO_LARGE_MESSAGE,
  TABLE_FILE_UNREADABLE_MESSAGE,
  TABLE_NOT_SET_UP_MESSAGE,
  TableFileError
} from './table-file';

const xlsxBuffer = async (build: (workbook: ExcelJS.Workbook) => void): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

/** Byte-for-byte the files in `damplab-ui/test-fixtures/sample-sheets/`; the hash test pins that without reading across repos. */
const fixture = (name: string): Buffer => readFileSync(resolve(__dirname, '../../../test-fixtures/sample-sheets', name));

describe('the messages (identical in damplab-ui/src/utils/sampleSheet.ts)', () => {
  it('are these exact strings', () => {
    expect(TABLE_FILE_UNREADABLE_MESSAGE).toBe('This file could not be read as a spreadsheet. Save it as .xlsx or .csv and try again.');
    expect(TABLE_FILE_NO_SHEETS_MESSAGE).toBe('This spreadsheet has no sheets in it.');
    expect(TABLE_FILE_TOO_LARGE_MESSAGE).toBe('This file must be smaller than 10 MB.');
    expect(TABLE_FILE_NOT_FETCHED_MESSAGE).toBe('This file could not be read; upload it again.');
    expect(TABLE_NOT_SET_UP_MESSAGE).toBe('This table has not been set up yet.');
    expect(missingColumnsMessage(['Concentration', 'Location'])).toBe('This file is missing the columns: Concentration, Location.');
    expect(missingColumnsMessage(['Location'])).toBe('This file is missing the columns: Location.');
  });
});

describe('readTableRows (rule 18)', () => {
  it('takes the first row with any content as the header and counts every later row with any content', () => {
    expect(readTableRows([[], ['', '  '], ['Inducer', ' Concentration ', ''], ['IPTG', '1'], [null, undefined], ['', '2'], ['  ']])).toEqual({ header: ['Inducer', 'Concentration'], rowCount: 2 });
  });

  it('is an empty header and zero rows for nothing at all', () => {
    expect(readTableRows([])).toEqual({ header: [], rowCount: 0 });
    expect(readTableRows([[''], [null]])).toEqual({ header: [], rowCount: 0 });
  });

  it('accepts a header with nothing below it, counting 0', () => {
    expect(readTableRows([['Inducer', 'Concentration']])).toEqual({ header: ['Inducer', 'Concentration'], rowCount: 0 });
  });

  it('does not look for the header: a title row above it is the header, and the real header is counted', () => {
    expect(readTableRows([['Plate map v3'], ['Inducer', 'Concentration'], ['IPTG', '1']])).toEqual({ header: ['Plate map v3'], rowCount: 2 });
  });
});

describe('missingColumns (rule 19)', () => {
  it('matches after trimming and ignoring case, in any order, with extra header cells ignored', () => {
    expect(missingColumns(['  location', 'NOTES', 'Inducer ', 'concentration'], ['Inducer', 'Concentration', 'Location'])).toEqual([]);
  });

  it('names every missing column in expected order and expected spelling', () => {
    expect(missingColumns(['inducer'], ['Inducer', 'Concentration', 'Location'])).toEqual(['Concentration', 'Location']);
  });

  it('is never missing anything when no columns are expected (rule 20)', () => {
    expect(missingColumns([], [])).toEqual([]);
    expect(missingColumns(['Anything'], [])).toEqual([]);
  });
});

describe('readTableFile', () => {
  it('reads an .xlsx by its cells, not its declared range', async () => {
    const buffer = await xlsxBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Table');
      sheet.addRow(['Inducer', 'Concentration']);
      sheet.addRow(['IPTG', 1]);
      sheet.addRow(['aTc', 2]);
      for (let r = 10; r < 60; r++) sheet.getCell(`A${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    });
    await expect(readTableFile(buffer)).resolves.toEqual({ header: ['Inducer', 'Concentration'], rowCount: 2 });
  });

  it('reads the first sheet only, skipping a hidden first sheet', async () => {
    const two = await xlsxBuffer((workbook) => {
      workbook.addWorksheet('Table').addRows([['Inducer'], ['IPTG']]);
      workbook.addWorksheet('Notes').addRows([['Note'], ['n1'], ['n2']]);
    });
    await expect(readTableFile(two)).resolves.toEqual({ header: ['Inducer'], rowCount: 1 });
    const hiddenFirst = await xlsxBuffer((workbook) => {
      workbook.addWorksheet('Hidden', { state: 'hidden' }).addRows([['Ignore'], ['x1'], ['x2']]);
      workbook.addWorksheet('Table').addRows([['Inducer'], ['IPTG']]);
    });
    await expect(readTableFile(hiddenFirst)).resolves.toEqual({ header: ['Inducer'], rowCount: 1 });
  });

  it('reads a formula header and formula cells by their results', async () => {
    const buffer = await xlsxBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Table');
      sheet.addRow(['Inducer', { formula: '"Con"&"centration"', result: 'Concentration' }]);
      sheet.addRow(['IPTG', { formula: '1+1', result: 2 }]);
    });
    await expect(readTableFile(buffer)).resolves.toEqual({ header: ['Inducer', 'Concentration'], rowCount: 1 });
  });

  it('reads a .csv, skipping blank and comma-only lines and honouring quoted commas', async () => {
    const csv = 'Inducer,Concentration\r\nIPTG,1\r\n"aTc, fresh",2\r\n\r\n,\r\n';
    await expect(readTableFile(Buffer.from(csv, 'utf8'))).resolves.toEqual({ header: ['Inducer', 'Concentration'], rowCount: 2 });
  });

  // Review Focus 1: Excel's "CSV UTF-8" starts with a byte-order mark.
  it('ignores a UTF-8 byte-order mark, so the first header cell still matches its column', async () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Inducer,Concentration\nIPTG,1\n', 'utf8')]);
    const contents = await readTableFile(buffer);
    expect(contents).toEqual({ header: ['Inducer', 'Concentration'], rowCount: 1 });
    expect(missingColumns(contents.header, ['Inducer', 'Concentration'])).toEqual([]);
  });

  it('refuses bytes that are neither a workbook nor text (rule 21)', async () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00]);
    await expect(readTableFile(xls)).rejects.toThrow(TABLE_FILE_UNREADABLE_MESSAGE);
    await expect(readTableFile(xls)).rejects.toBeInstanceOf(TableFileError);
    await expect(readTableFile(Buffer.from('%PDF-1.4\n\u0000\u0001\u0002', 'latin1'))).rejects.toThrow(TABLE_FILE_UNREADABLE_MESSAGE);
  });

  it('refuses a zip that is not a workbook', async () => {
    // "PK" magic followed by junk: a corrupt or foreign archive.
    await expect(readTableFile(Buffer.concat([Buffer.from('PK'), Buffer.alloc(40, 7)]))).rejects.toBeInstanceOf(TableFileError);
  });

  it('refuses a file over the size cap without parsing it', async () => {
    await expect(readTableFile(Buffer.alloc(TABLE_FILE_MAX_BYTES + 1, 0x61))).rejects.toThrow(TABLE_FILE_TOO_LARGE_MESSAGE);
  });

  // I1: the 10 MB cap is on compressed bytes; the inflated size is what costs memory.
  it('refuses a small zip that inflates beyond the inflated-size cap, as unreadable', async () => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', Buffer.alloc(TABLE_FILE_MAX_INFLATED_BYTES + 1024 * 1024, 0x61));
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(bomb.byteLength).toBeLessThan(TABLE_FILE_MAX_BYTES);
    await expect(readTableFile(bomb)).rejects.toThrow(TABLE_FILE_UNREADABLE_MESSAGE);
  });

  it('does not materialise rows that only carry formatting', async () => {
    const buffer = await xlsxBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Table');
      sheet.addRows([['Inducer'], ['IPTG']]);
      sheet.getCell('A1000000').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    });
    await expect(readTableFile(buffer)).resolves.toEqual({ header: ['Inducer'], rowCount: 1 });
  });

  // F12: exceljs types CSV cells before .text; a header is its text.
  it('reads CSV header cells as written, not as numbers or dates', async () => {
    const contents = await readTableFile(Buffer.from('2024-01-05,007,1.50\nx,y,z\n', 'utf8'));
    expect(contents.header).toEqual(['2024-01-05', '007', '1.50']);
  });

  it('refuses a CSV with an unterminated quote as unreadable (the browser reader does the same)', async () => {
    await expect(readTableFile(Buffer.from('Inducer,"Concentration\nIPTG,1\n', 'utf8'))).rejects.toThrow(TABLE_FILE_UNREADABLE_MESSAGE);
  });

  it('accepts a header with zero rows below, counting 0', async () => {
    const buffer = await xlsxBuffer((workbook) => {
      workbook.addWorksheet('Table').addRow(['Inducer', 'Concentration']);
    });
    await expect(readTableFile(buffer)).resolves.toEqual({ header: ['Inducer', 'Concentration'], rowCount: 0 });
  });
});

describe('checkTableFile', () => {
  it('returns the row count when every expected column is in the header', async () => {
    await expect(checkTableFile(fixture('samples-96.xlsx'), ['sample id', 'Notes'])).resolves.toBe(96);
    await expect(checkTableFile(fixture('samples-with-gaps.csv'), ['Volume', 'Sample ID'])).resolves.toBe(3);
  });

  it('refuses with the message naming every missing column', async () => {
    await expect(checkTableFile(fixture('samples-with-gaps.csv'), ['Sample ID', 'Concentration', 'Location'])).rejects.toThrow('This file is missing the columns: Concentration, Location.');
    await expect(checkTableFile(fixture('samples-with-gaps.csv'), ['Concentration'])).rejects.toBeInstanceOf(TableFileError);
  });

  it('refuses a sheet with a title row above its header when columns are expected: the title row is the header', async () => {
    await expect(checkTableFile(fixture('samples-with-banner.xlsx'), ['Sample ID'])).rejects.toThrow('This file is missing the columns: Sample ID.');
  });

  it('has no column check when no columns are expected (rule 20): any readable spreadsheet is counted', async () => {
    await expect(checkTableFile(fixture('samples-with-banner.xlsx'), [])).resolves.toBe(5);
    await expect(checkTableFile(fixture('template-with-banner.xlsx'), [])).resolves.toBe(1);
  });

  it('keeps the fixtures byte-identical to the UI repo copy (pinned hashes)', () => {
    const expected: Record<string, string> = {
      'samples-96.xlsx': '65f9e17b5e998608381f5979a4a96021ca8440227fc92d38b17426c931f90bfc',
      'samples-with-gaps.csv': '4b2fd83ec9429a8704a4243db216a0834d402386df7e532aece603315e4dcc70',
      'template-with-banner.xlsx': 'd86034e74901ca53b82d59b0d657f6c14a0395531bc2f1759bffcbc51371211a',
      'samples-with-banner.xlsx': 'a0447dc38ae4007ab9f03885c10b42f872743ddb17139b3fbee2306699a815fd'
    };
    for (const [name, hash] of Object.entries(expected)) expect(createHash('sha256').update(fixture(name)).digest('hex')).toBe(hash);
  });
});
