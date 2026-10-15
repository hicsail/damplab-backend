import * as ExcelJS from 'exceljs';
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

export const TABLE_FILE_UNREADABLE_MESSAGE = 'This file could not be read as a spreadsheet. Save it as .xlsx or .csv and try again.';
export const TABLE_FILE_NO_SHEETS_MESSAGE = 'This spreadsheet has no sheets in it.';
export const TABLE_FILE_TOO_LARGE_MESSAGE = 'This file must be smaller than 10 MB.';
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

/** `cell.text` renders a formula by its cached result, rich text as its string and an empty cell as ''. */
function worksheetRows(worksheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let column = 1; column <= row.cellCount; column++) cells.push(row.getCell(column).text ?? '');
    rows.push(cells);
  });
  return rows;
}

/** Every `.xlsx` is a zip archive, which starts with these two bytes. */
const isZip = (buffer: Buffer): boolean => buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
const hasUtf8Bom = (buffer: Buffer): boolean => buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;

/**
 * The first visible worksheet of the bytes, by what the bytes are: `PK` magic
 * is a workbook; anything else is CSV text, unless it holds a NUL byte, which
 * no text file does (that is what turns away `.xls`, PDFs and images).
 */
async function firstWorksheet(buffer: Buffer): Promise<ExcelJS.Worksheet | undefined> {
  const workbook = new ExcelJS.Workbook();
  if (isZip(buffer)) {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    return workbook.worksheets.find((sheet) => sheet.state === 'visible') ?? workbook.worksheets[0];
  }
  if (buffer.includes(0)) throw new TableFileError(TABLE_FILE_UNREADABLE_MESSAGE);
  // Through exceljs rather than splitting on newlines: a quoted cell may hold the delimiter or a line break.
  return workbook.csv.read(Readable.from(hasUtf8Bom(buffer) ? buffer.subarray(3) : buffer));
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
