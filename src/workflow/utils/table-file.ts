import * as ExcelJS from 'exceljs';
import * as JSZip from 'jszip';
import { Readable } from 'stream';

/**
 * Reading the spreadsheet a customer uploads as a Table answer.
 *
 * The row count multiplies the price of the operation the file is attached to,
 * so the server is the only thing allowed to produce it: the browser's count
 * is a preview. The browser twin is `damplab-ui/src/utils/sampleSheet.ts`; the
 * two are held together by the same fixture files and the same message strings
 * in both test suites.
 *
 * The bytes are the only input. The file's name and declared content type are
 * never consulted.
 */

export const TABLE_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** The most a workbook may inflate to, counted as it is inflated (the 10 MB cap above is on compressed bytes). */
export const TABLE_FILE_MAX_INFLATED_BYTES = 50 * 1024 * 1024;

export const TABLE_FILE_UNREADABLE_MESSAGE = 'This file could not be read as a spreadsheet. Save it as .xlsx or .csv and try again.';
export const TABLE_FILE_NO_SHEETS_MESSAGE = 'This spreadsheet has no sheets in it.';
export const TABLE_FILE_TOO_LARGE_MESSAGE = 'This file must be smaller than 10 MB.';
/** A workbook under 10 MB whose contents inflate past TABLE_FILE_MAX_INFLATED_BYTES (about 9 MB of typical lab data). */
export const TABLE_FILE_TOO_LARGE_TO_READ_MESSAGE = 'This spreadsheet is too large to read. Remove unused rows and columns and try again.';
export const TABLE_FILE_NOT_FETCHED_MESSAGE = 'This file could not be read; upload it again.';
export const TABLE_NOT_SET_UP_MESSAGE = 'This table has not been set up yet.';

export const missingColumnsMessage = (missing: readonly string[]): string => `This file is missing the columns: ${missing.join(', ')}.`;

/** A file the lab cannot accept. Carries a message meant for the person who uploaded it. */
export class TableFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableFileError';
  }
}

export interface TableFileContents {
  /** The cells of the header row, trimmed, blanks left out. */
  header: string[];
  /** Rows below the header that carry anything. */
  rowCount: number;
}

const cellText = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim());
const rowHasContent = (row: ReadonlyArray<unknown> | undefined): boolean => (row ?? []).some((cell) => cellText(cell) !== '');

/**
 * The whole rule, with nothing inferred: the first row with any content is the
 * header, and every later row with any content in any cell is one row of the
 * count. Nothing looks for the header by what it contains — a title row above
 * it is the header, and then the column check fails. Emptiness is decided per
 * cell rather than by the sheet's declared range, because Excel reports rows
 * that were merely formatted as part of the sheet.
 */
export function readTableRows(rows: ReadonlyArray<ReadonlyArray<unknown>>): TableFileContents {
  const list = rows ?? [];
  const headerIndex = list.findIndex(rowHasContent);
  if (headerIndex === -1) return { header: [], rowCount: 0 };
  let rowCount = 0;
  for (let i = headerIndex + 1; i < list.length; i++) if (rowHasContent(list[i])) rowCount++;
  return { header: list[headerIndex].map(cellText).filter((cell) => cell !== ''), rowCount };
}

const columnKey = (name: string): string => name.trim().toLowerCase();

/** The expected columns no header cell equals after trimming and ignoring case. Order and extra cells do not matter. */
export function missingColumns(header: readonly string[], expected: readonly string[]): string[] {
  const present = new Set(header.map(columnKey));
  return expected.filter((column) => !present.has(columnKey(column)));
}

/** Index order of the slots set in a sparse array: `Object.keys` visits only those, ascending. */
const presentSlots = <T>(slots: readonly T[]): T[] => Object.keys(slots).map((key) => slots[Number(key)]);

/**
 * The rows a worksheet holds and the cells each row holds, both in order, as
 * `eachRow()` / `eachCell()` give them but without visiting the gaps. Read
 * through exceljs's private `_rows` and `_cells` arrays (exceljs 4.4.0,
 * lib/doc/worksheet.js and lib/doc/row.js) because every public walk —
 * `eachRow`, `rowCount` with `findRow`, `eachCell`, `values`, `hasValues` —
 * visits every slot up to the last row or the row's last cell. One cell in
 * column XFD is 16,384 slots (30,000 such rows blocked the event loop for about
 * 24 s), and one row numbered 2,000,000,000 is two billion. If exceljs changes
 * that shape, this falls back to the public walk (correct, only slower), and
 * table-file.spec.ts fails loudly by comparing the two on real workbooks.
 */
export function worksheetCells(worksheet: ExcelJS.Worksheet): ExcelJS.Cell[][] {
  const rowSlots = (worksheet as unknown as { _rows?: unknown })._rows;
  if (!Array.isArray(rowSlots)) {
    const rows: ExcelJS.Cell[][] = [];
    worksheet.eachRow((row) => {
      const cells: ExcelJS.Cell[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => cells.push(cell));
      rows.push(cells);
    });
    return rows;
  }
  const rows: ExcelJS.Cell[][] = [];
  for (const row of presentSlots(rowSlots as (ExcelJS.Row | undefined)[])) {
    if (!row) continue;
    const cellSlots = (row as unknown as { _cells?: unknown })._cells;
    const cells: ExcelJS.Cell[] = [];
    if (Array.isArray(cellSlots)) {
      for (const cell of presentSlots(cellSlots as (ExcelJS.Cell | undefined)[])) if (cell && cell.type !== ExcelJS.ValueType.Null) cells.push(cell);
    } else row.eachCell({ includeEmpty: false }, (cell) => cells.push(cell));
    rows.push(cells);
  }
  return rows;
}

/**
 * Each row's cells as text. `cell.text` renders a formula by its cached
 * result, rich text as its string, an error as its error text (`#N/A`) and an
 * empty cell as ''. Position does not matter: blanks are dropped from the
 * header and a row's emptiness is any cell having content. A row with no
 * cells is kept as an empty row, which the rule treats as no row.
 */
const worksheetRows = (worksheet: ExcelJS.Worksheet): string[][] => worksheetCells(worksheet).map((cells) => cells.map((cell) => cell.text ?? ''));

/** Every `.xlsx` is a zip archive, which starts with these two bytes. */
const isZip = (buffer: Buffer): boolean => buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
const hasUtf8Bom = (buffer: Buffer): boolean => buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;

/**
 * Refuses an archive whose entries inflate beyond TABLE_FILE_MAX_INFLATED_BYTES,
 * as too large to read (the browser twin applies the same cap before its preview).
 * The sizes a zip declares are the attacker's to choose, so this inflates every
 * entry as a stream and counts the bytes that actually come out, stopping at the
 * cap; the declared sizes are never consulted. A malformed archive throws too.
 */
async function assertInflatedWithinCap(buffer: Buffer): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    await new Promise<void>((resolve, reject) => {
      const stream = entry.nodeStream('nodebuffer');
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > TABLE_FILE_MAX_INFLATED_BYTES) {
          stream.pause();
          reject(new TableFileError(TABLE_FILE_TOO_LARGE_TO_READ_MESSAGE));
        }
      });
      stream.on('error', reject);
      stream.on('end', () => resolve());
    });
  }
}

/**
 * The first visible worksheet of the bytes, by what the bytes are: `PK` magic
 * is a workbook; anything else is CSV text, unless it holds a NUL byte, which
 * no text file does (that is what turns away `.xls`, PDFs and images).
 */
async function firstWorksheet(buffer: Buffer): Promise<ExcelJS.Worksheet | undefined> {
  const workbook = new ExcelJS.Workbook();
  if (isZip(buffer)) {
    await assertInflatedWithinCap(buffer);
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    return workbook.worksheets.find((sheet) => sheet.state === 'visible') ?? workbook.worksheets[0];
  }
  if (buffer.includes(0)) throw new TableFileError(TABLE_FILE_UNREADABLE_MESSAGE);
  // Through exceljs rather than splitting on newlines: a quoted cell may hold the delimiter or a line break.
  return workbook.csv.read(Readable.from(hasUtf8Bom(buffer) ? buffer.subarray(3) : buffer), {
    // A header is its text: left to itself exceljs turns `007` into 7 and `2024-01-05` into a date.
    map: (cell: string) => cell
  });
}

/** The header row and row count of an uploaded file, or a TableFileError saying why it cannot be read. */
export async function readTableFile(buffer: Buffer): Promise<TableFileContents> {
  if (buffer.byteLength > TABLE_FILE_MAX_BYTES) throw new TableFileError(TABLE_FILE_TOO_LARGE_MESSAGE);
  let worksheet: ExcelJS.Worksheet | undefined;
  try {
    worksheet = await firstWorksheet(buffer);
  } catch (error) {
    if (error instanceof TableFileError) throw error;
    throw new TableFileError(TABLE_FILE_UNREADABLE_MESSAGE);
  }
  if (!worksheet) throw new TableFileError(TABLE_FILE_NO_SHEETS_MESSAGE);
  const contents = readTableRows(worksheetRows(worksheet));
  // A byte-order mark that survived parsing would sit on the first header cell.
  return { ...contents, header: contents.header.map((cell) => cell.replace(/^\uFEFF/, '').trim()).filter((cell) => cell !== '') };
}

/** The row count of a file that carries every expected column. No columns expected means no column check. */
export async function checkTableFile(buffer: Buffer, expected: readonly string[]): Promise<number> {
  const { header, rowCount } = await readTableFile(buffer);
  const missing = missingColumns(header, expected);
  if (missing.length > 0) throw new TableFileError(missingColumnsMessage(missing));
  return rowCount;
}
