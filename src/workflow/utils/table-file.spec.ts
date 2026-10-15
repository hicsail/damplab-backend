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
  TABLE_FILE_TOO_LARGE_TO_READ_MESSAGE,
  TABLE_FILE_UNREADABLE_MESSAGE,
  TABLE_NOT_SET_UP_MESSAGE,
  TableFileError,
  worksheetCells
} from './table-file';

const xlsxBuffer = async (build: (workbook: ExcelJS.Workbook) => void): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

/** A minimal workbook whose one sheet's `<sheetData>` is written by hand: exceljs's writer would itself walk the gaps. */
const handBuiltXlsx = async (sheetData: string): Promise<Buffer> => {
  const zip = new JSZip();
  const rels = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
  );
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rels}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  zip.file(
    'xl/workbook.xml',
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rels}"><sheets><sheet name="Table" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rels}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
  );
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
const inlineCell = (address: string, text: string): string => `<c r="${address}" t="inlineStr"><is><t>${text}</t></is></c>`;

/** Byte-for-byte the files in `damplab-ui/test-fixtures/sample-sheets/`; the hash test pins that without reading across repos. */
const fixture = (name: string): Buffer => readFileSync(resolve(__dirname, '../../../test-fixtures/sample-sheets', name));

describe('the messages (identical in damplab-ui/src/utils/sampleSheet.ts)', () => {
  it('are these exact strings', () => {
    expect(TABLE_FILE_UNREADABLE_MESSAGE).toBe('This file could not be read as a spreadsheet. Save it as .xlsx or .csv and try again.');
    expect(TABLE_FILE_NO_SHEETS_MESSAGE).toBe('This spreadsheet has no sheets in it.');
    expect(TABLE_FILE_TOO_LARGE_MESSAGE).toBe('This file must be smaller than 10 MB.');
    expect(TABLE_FILE_TOO_LARGE_TO_READ_MESSAGE).toBe('This spreadsheet is too large to read. Remove unused rows and columns and try again.');
    // The browser applies the same inflated-size cap before its preview accepts a file.
    expect(TABLE_FILE_MAX_INFLATED_BYTES).toBe(50 * 1024 * 1024);
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
  // I5: over the cap is a size refusal, not "not a spreadsheet".
  it('refuses a small zip that inflates beyond the inflated-size cap, as too large to read', async () => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', Buffer.alloc(TABLE_FILE_MAX_INFLATED_BYTES + 1024 * 1024, 0x61));
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(bomb.byteLength).toBeLessThan(TABLE_FILE_MAX_BYTES);
    await expect(readTableFile(bomb)).rejects.toThrow(TABLE_FILE_TOO_LARGE_TO_READ_MESSAGE);
  });

  // I5: a valid workbook (header `Inducer`, one row) padded with 52 MiB of whitespace between its rows. The browser
  // refuses the same file with the same message before its preview, so the two never disagree on an over-cap file.
  it('refuses a valid workbook that inflates past the cap with the too-large-to-read message (shared fixture)', async () => {
    const buffer = fixture('over-inflation-cap.xlsx');
    expect(buffer.byteLength).toBeLessThan(TABLE_FILE_MAX_BYTES);
    await expect(readTableFile(buffer)).rejects.toThrow(new TableFileError(TABLE_FILE_TOO_LARGE_TO_READ_MESSAGE));
  });

  it('keeps the unreadable message for a zip that is not a valid archive', async () => {
    await expect(readTableFile(Buffer.from('PK\u0003\u0004 not really a zip at all', 'latin1'))).rejects.toThrow(TABLE_FILE_UNREADABLE_MESSAGE);
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

  // M1: a header cell that is a number reads as its value's text, in both readers (a display format such as 000 is not applied).
  it('reads numeric .xlsx header cells as their value’s text (shared fixture)', async () => {
    await expect(readTableFile(fixture('numeric-header.xlsx'))).resolves.toEqual({ header: ['Sample ID', '2024', '7', '1.5'], rowCount: 2 });
  });

  // C1/C2: a row's width is whatever column its last cell is in. A dense walk made one cell in XFD cost 16,384 cells of
  // memory (C1); exceljs's own eachRow/eachCell skip the holes but still visit every slot, so 30,000 such rows blocked
  // the event loop for about 24 s (C2). The read must cost what the cells present cost. Shared with the UI repo, which
  // reads the same file to the same result. The fixture is a hand-built workbook: A1 `Inducer`, XFD1 `Far`, then rows
  // 2..30001 each holding one inline string in XFD.
  it('reads 30,000 rows whose only cell is in the last column (XFD) in well under 2 s (shared fixture)', async () => {
    const buffer = fixture('last-column-rows.xlsx');
    const before = process.memoryUsage().heapUsed;
    const started = Date.now();
    await expect(readTableFile(buffer)).resolves.toEqual({ header: ['Inducer', 'Far'], rowCount: 30000 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(300 * 1024 * 1024);
  }, 120000);

  // C2: the row walk too must cost the rows present, not the last row's number (exceljs's eachRow visits every slot).
  it('reads a sheet whose second row is numbered 2,000,000,000 in well under 2 s', async () => {
    const buffer = await handBuiltXlsx(`<row r="1">${inlineCell('A1', 'Inducer')}</row><row r="2000000000">${inlineCell('A2000000000', 'IPTG')}</row>`);
    const started = Date.now();
    await expect(readTableFile(buffer)).resolves.toEqual({ header: ['Inducer'], rowCount: 1 });
    expect(Date.now() - started).toBeLessThan(2000);
  }, 300000);

  // m5: an error cell reads as its error text in both readers (the browser used to read #N/A as its code, 42).
  it('reads an error cell as its error text (shared fixture)', async () => {
    await expect(readTableFile(fixture('error-cells.xlsx'))).resolves.toEqual({ header: ['#N/A', 'Inducer'], rowCount: 1 });
  });

  // m6: the dynamic-array errors too. A1 `#SPILL!` (error), B1 `Inducer`; A2 `#CALC!` only; B3 `IPTG`.
  it('reads #SPILL! and #CALC! cells as their error text and counts a row holding only one (shared fixture)', async () => {
    await expect(readTableFile(fixture('spill-cells.xlsx'))).resolves.toEqual({ header: ['#SPILL!', 'Inducer'], rowCount: 2 });
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

// worksheetCells reads exceljs's private row and cell storage to skip the gaps. If an exceljs upgrade changes that
// storage, this is where it shows: the fast read must list exactly the cells the public eachRow/eachCell walk lists.
describe('worksheetCells (exceljs private storage, pinned against the public walk)', () => {
  const publicWalk = (worksheet: ExcelJS.Worksheet): string[] => {
    const seen: string[] = [];
    worksheet.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => seen.push(`${cell.address}=${cell.text}`)));
    return seen;
  };
  const fastWalk = (worksheet: ExcelJS.Worksheet): string[] => worksheetCells(worksheet).flatMap((cells) => cells.map((cell) => `${cell.address}=${cell.text}`));
  const loaded = async (buffer: Buffer): Promise<ExcelJS.Worksheet> => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    return workbook.worksheets[0];
  };

  // m7: worksheetCells reads 4.4.0 internals, so an upgrade must be a deliberate change that passes these specs.
  it('runs on exceljs pinned to exactly 4.4.0', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.exceljs).toBe('4.4.0');
    const installed = JSON.parse(readFileSync(require.resolve('exceljs/package.json'), 'utf8')) as { version: string };
    expect(installed.version).toBe('4.4.0');
  });

  it('still finds exceljs keeping rows and cells in sparse arrays', async () => {
    const worksheet = await loaded(fixture('samples-96.xlsx'));
    const rows = (worksheet as unknown as { _rows: unknown })._rows;
    expect(Array.isArray(rows)).toBe(true);
    expect(Array.isArray((worksheet.findRow(1) as unknown as { _cells: unknown })._cells)).toBe(true);
  });

  it('lists the same cells in the same order as eachRow/eachCell', async () => {
    const built = await xlsxBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Table');
      sheet.getCell('C2').value = 'Inducer';
      sheet.getCell('E2').value = 'Conc';
      sheet.getCell('A4').value = 'merged';
      sheet.mergeCells('A4:C5');
      sheet.getCell('Z6').value = { formula: '1+1', result: 2 };
      sheet.getCell('AA7').value = { error: '#REF!' };
      sheet.getCell('B8').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
      sheet.getCell('XFD9').value = 'far';
    });
    const files = [built, ...['samples-96.xlsx', 'samples-with-banner.xlsx', 'template-with-banner.xlsx', 'numeric-header.xlsx', 'error-cells.xlsx'].map(fixture)];
    for (const buffer of files) {
      const worksheet = await loaded(buffer);
      const expected = publicWalk(worksheet);
      expect(expected.length).toBeGreaterThan(0);
      expect(fastWalk(worksheet)).toEqual(expected);
    }
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
      'samples-with-banner.xlsx': 'a0447dc38ae4007ab9f03885c10b42f872743ddb17139b3fbee2306699a815fd',
      'numeric-header.xlsx': '6ea2cb9ee9f6255f3279026643fa30e3c6d124e20931d2084ebc8516027ad660',
      'last-column-rows.xlsx': '90fc23353c38dd7cf67a57c95d92acfb0bfb124352b2433d9cd43a598816af0f',
      'error-cells.xlsx': '8cc104c8d7385a9d475f55e195bc8537a0fe427f4b9c87d6ab4feadc5e73489b',
      'spill-cells.xlsx': '375bb52a27337d4f62b270bbc06834cb50fcafa8c67ca997686ab1b10a4a5bcd',
      'over-inflation-cap.xlsx': '4de5d8bc255713bae604f57c630712e89c32b715fee1b83c815019a05726c2e2'
    };
    for (const [name, hash] of Object.entries(expected)) expect(createHash('sha256').update(fixture(name)).digest('hex')).toBe(hash);
  });
});
