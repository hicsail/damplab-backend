import { Job, JobState } from '../../job/job.model';

/**
 * A Table is a catalog parameter whose stored type is `table` or `sampleSheet`:
 * staff list its columns (and may attach a blank template), the customer
 * downloads a template, fills it in and attaches it to the operation, and the
 * number of rows below the header is the sample count.
 *
 * The server reads the uploaded file and writes the count itself
 * (`table-answers.ts`, `table-file.ts`); a count the client sends is ignored.
 * On an operation priced "by parameter" a value the server counted is the
 * quantity the parameter's price is multiplied by (`SERVER_COUNTED` below).
 *
 * The stored value is a JSON string in the node's formData, the same shape as a
 * `file` parameter plus `sampleCount`, so everything that already reads file
 * parameters (the download presign in the node resolver, the job pages, the
 * job editor) keeps working unchanged.
 */
/** The stored string for a Table parameter. */
export const TABLE_PARAM_TYPE = 'table';

/**
 * What a Table was stored as before the two types were merged. Read as a Table
 * everywhere, and never rewritten: a parameter stored with this string keeps
 * it, because pricing prices its old answers by it (see service-pricing.util.ts).
 * Only a new Table is written as `table`.
 */
export const SAMPLE_SHEET_PARAM_TYPE = 'sampleSheet';

export const isTableType = (type: unknown): boolean => type === TABLE_PARAM_TYPE || type === SAMPLE_SHEET_PARAM_TYPE;

/** Where blank staff templates live. A template download presigns only keys under here. */
export const SAMPLE_SHEET_TEMPLATE_KEY_PREFIX = 'sample-sheet-templates/';

export interface SampleSheetTemplateFile {
  key: string;
  filename?: string;
  contentType?: string;
  size?: number;
}

export interface TableParam {
  id: string;
  type: string;
  name?: string;
  templateFile?: SampleSheetTemplateFile | null;
  tableData?: { columns?: unknown; rows?: unknown } | null;
}

/**
 * The row count stored with a sampleSheet value — a JSON string on the node,
 * or the parsed object the resolver returns. Undefined when there is no file
 * or no count. When the operation is priced by parameter this is the quantity
 * the parameter's price is multiplied by (service-pricing.util.ts), so it is
 * a billing input: the customer's browser wrote it, and staff can see the file
 * and the number on the job page and replace the sheet to recount.
 */
export function sampleCountFromValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  let parsed: any = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const count = parsed.sampleCount;
  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : undefined;
}

export const isTableParam = (param: unknown): param is TableParam =>
  !!param && typeof param === 'object' && isTableType((param as { type?: unknown }).type) && typeof (param as { id?: unknown }).id === 'string';

export function findTableParam(parameters: unknown, parameterId: string): TableParam | null {
  if (!Array.isArray(parameters)) return null;
  const match = parameters.find((param) => isTableParam(param) && param.id === parameterId);
  return match ? (match as TableParam) : null;
}

/** The staff template key on a parameter, or null when there is none or it is not a template key. */
export function templateKeyOf(param: unknown): string | null {
  const key = (param as { templateFile?: { key?: unknown } | null } | null | undefined)?.templateFile?.key;
  if (typeof key !== 'string' || !key.startsWith(SAMPLE_SHEET_TEMPLATE_KEY_PREFIX)) return null;
  return key;
}

/**
 * The columns an uploaded file must carry: the `header` of each entry of
 * `tableData.columns`, trimmed, in order, blanks left out. `tableData.rows` is
 * never read.
 */
export function expectedColumns(param: unknown): string[] {
  const columns = (param as { tableData?: { columns?: unknown } | null } | null | undefined)?.tableData?.columns;
  if (!Array.isArray(columns)) return [];
  return columns
    .map((column) => (column && typeof column === 'object' && typeof (column as { header?: unknown }).header === 'string' ? (column as { header: string }).header.trim() : ''))
    .filter((header) => header !== '');
}

/** A Table can be answered only when it has a column or a staff template. */
export const tableIsSetUp = (param: unknown): boolean => expectedColumns(param).length > 0 || templateKeyOf(param) !== null;

const tableDefinitionKey = (param: unknown): string => JSON.stringify([expectedColumns(param), templateKeyOf(param)]);

/**
 * Why a Table definition may not be saved, or null. A Table needs a column or
 * a staff template, or no file could ever be checked against it. Refused only
 * when this write is what leaves it that way — the parameter is new, or its
 * type (`sampleSheet` and `table` being one type), columns or template differ
 * from `previous`, the stored parameter of the same id — so a catalog that
 * already holds such a Table can still be edited elsewhere.
 */
export function tableDefinitionError(parameter: unknown, previous: unknown): string | null {
  if (!parameter || typeof parameter !== 'object') return null;
  const p = parameter as { id?: unknown; name?: unknown; type?: unknown };
  if (!isTableType(p.type) || tableIsSetUp(parameter)) return null;
  const before = previous as { type?: unknown } | null | undefined;
  if (before && typeof before === 'object' && isTableType(before.type) && tableDefinitionKey(before) === tableDefinitionKey(parameter)) return null;
  const label = typeof p.name === 'string' && p.name.trim() !== '' ? p.name.trim() : String(p.id ?? '');
  return `Parameter “${label}”: a Table needs at least one column.`;
}

/** Stored parameters by id, for `tableDefinitionError`'s `previous`. */
export function parametersById(parameters: unknown): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  if (Array.isArray(parameters)) for (const p of parameters) if (p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string') byId.set((p as { id: string }).id, p);
  return byId;
}

/** Ids of the parameters whose stored value is a storage key: `file` and Table. */
export function fileParameterIds(parameters: unknown): string[] {
  if (!Array.isArray(parameters)) return [];
  return parameters.filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && (p.type === 'file' || isTableType(p.type))).map((p) => p.id as string);
}

/** The mark the server puts on a Table value whose rows it counted itself (`countedBy`). */
export const SERVER_COUNTED = 'server';

export function fileRecord(value: unknown): Record<string, unknown> | undefined {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}

/**
 * The rows the server itself counted in a Table answer: the `sampleCount` of a
 * value carrying `countedBy: 'server'`, summed over an array. Undefined when no
 * value carries the mark — which is every answer stored before the server
 * started counting. Pricing bills per row from this alone; an answer without
 * the mark is priced by the code that priced it before, so its bill cannot
 * have moved.
 */
export function serverCountedRows(value: unknown): number | undefined {
  let rows: number | undefined;
  for (const element of Array.isArray(value) ? value : [value]) {
    const record = fileRecord(element);
    const count = record?.sampleCount;
    if (record?.countedBy !== SERVER_COUNTED || typeof count !== 'number' || !Number.isFinite(count) || count < 0) continue;
    rows = (rows ?? 0) + count;
  }
  return rows;
}

/** Whether a stored answer, or any element of it, is a file record with a storage key. */
export const holdsStorageKey = (value: unknown): boolean => (Array.isArray(value) ? value.some(holdsStorageKey) : sampleSheetKeyOf(value) !== undefined);

/**
 * The prefix `createWorkflowParameterUploadUrls` mints keys under for this
 * caller. A replacement must name a key under the caller's own prefix, because
 * the node resolver presigns a download for whatever key is stored — accepting
 * a foreign key would let the writer read someone else's upload.
 */
export function uploadKeyPrefixFor(userSub: string | undefined): string {
  return `workflow-parameters/${userSub ?? 'anonymous'}/`;
}

/** Whether a storage key climbs out of its folder: `..` as a whole path segment. A name like `a..b.csv` does not. */
export const hasParentSegment = (key: string): boolean => key.split('/').includes('..');

export function keyBelongsToUploader(key: string, userSub: string | undefined): boolean {
  return typeof key === 'string' && key.startsWith(uploadKeyPrefixFor(userSub)) && !hasParentSegment(key);
}

/** A parameter's answer as a flat list: a multi-value answer is an array (possibly nested), anything else is one value. */
export function flattenValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value.flatMap(flattenValues) : [value];
}

/**
 * The first storage key among the answers to `file` and Table parameters that
 * is not under the caller's own upload prefix, or null when there is none.
 *
 * The node resolver presigns a download for every key stored on such a
 * parameter, and the server reads a Table's file itself, so an answer naming
 * someone else's key would hand the submitter that person's file. A value
 * with no key is not this function's business: nothing can be presigned from it.
 */
export function foreignFileKey(parameters: unknown, formData: ReadonlyArray<{ id: string; value?: unknown }>, userSub: string | undefined): string | null {
  const guarded = new Set(fileParameterIds(parameters));
  if (guarded.size === 0) return null;
  for (const entry of formData ?? []) {
    if (!entry || !guarded.has(entry.id)) continue;
    for (const value of flattenValues(entry.value)) {
      const key = sampleSheetKeyOf(value);
      if (key !== undefined && !keyBelongsToUploader(key, userSub)) return key;
    }
  }
  return null;
}

/**
 * The file name of the first answer to a file or Table parameter that is still the browser's placeholder for a picked
 * file (`__kind: 'pending-file'`) — a file that never reached storage, usually because the page reloaded before
 * submitting. Null when there is none. A value recorded by name only (`notUploaded`, the local-dev fallback) is not one.
 */
export function unuploadedFileName(parameters: unknown, formData: ReadonlyArray<{ id: string; value?: unknown }>): string | null {
  const guarded = new Set(fileParameterIds(parameters));
  for (const entry of formData ?? []) {
    if (!entry || !guarded.has(entry.id)) continue;
    for (const value of flattenValues(entry.value)) {
      const record = fileRecord(value);
      if (record?.__kind === 'pending-file') return typeof record.filename === 'string' && record.filename !== '' ? record.filename : 'file';
    }
  }
  return null;
}

/**
 * Why a sheet cannot be replaced right now, or null when it can.
 *
 * Deliberately wider than `assertJobContractWritable`: a sample list is the
 * working list of what is in the tubes, and either side may correct it at any
 * point until the job is finished with — including while the lab is running it.
 */
export function sampleSheetReplaceBlockedReason(job: Pick<Job, 'state'>): string | null {
  switch (job.state) {
    case JobState.CLOSED:
      return 'This job is closed, so its samples spreadsheet can no longer be replaced.';
    case JobState.CANCELLED:
      return 'This job was cancelled, so its samples spreadsheet can no longer be replaced.';
    case JobState.REJECTED:
      return 'This job was not accepted, so its samples spreadsheet can no longer be replaced.';
    default:
      return null;
  }
}

/** The storage key inside a stored sampleSheet value (JSON string, or the parsed object the editor round-trips), if any. */
export function sampleSheetKeyOf(value: unknown): string | undefined {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const key = (parsed as { key?: unknown }).key;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}
