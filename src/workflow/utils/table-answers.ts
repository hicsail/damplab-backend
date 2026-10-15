import { BadRequestException } from '@nestjs/common';
import { ObjectTooLargeError } from '../services/workflow-parameter-files.service';
import { FormDataEntry } from './form-data.util';
import { expectedColumns, fileRecord, flattenValues, hasParentSegment, isTableParam, sampleSheetKeyOf, SERVER_COUNTED, TableParam, tableIsSetUp } from './sample-sheet.util';
import { checkTableFile, TABLE_FILE_NOT_FETCHED_MESSAGE, TABLE_FILE_TOO_LARGE_MESSAGE, TABLE_NOT_SET_UP_MESSAGE, TableFileError } from './table-file';

/**
 * Table answers on their way into storage.
 *
 * A Table answer is a JSON string `{ filename, key, contentType, size,
 * sampleCount, uploadedAt, countedBy }`. `sampleCount` multiplies a price, so
 * no value a client sends for it is ever stored, and `countedBy: 'server'`
 * marks a count this file produced — pricing bills per row only for a value
 * that carries it:
 *
 *  - a key already stored on the node for that parameter is written back
 *    exactly as stored, stored count included, and is not read again — even if
 *    the catalog's columns have changed since;
 *  - any other key is fetched, checked against the catalog's columns as they
 *    are now, counted, and stored with the server's count.
 *
 * Callers strip the answers of hidden parameters first, so a hidden file is
 * never fetched, and run their key-ownership guards before `countNewTableAnswers`.
 */

/** Reads a stored object's bytes. Throws when it cannot. */
export type ReadObject = (key: string) => Promise<Buffer>;

/** The only place uploaded parameter files live. Nothing outside it is ever fetched as a Table file. */
export const TABLE_UPLOAD_KEY_PREFIX = 'workflow-parameters/';

const isBlank = (value: unknown): boolean => value === null || value === undefined || value === '';
/**
 * A value as order-free text: a JSON string is parsed first and object keys are sorted, so the same stored value
 * matches however the client spells it back (object or string, any key order).
 */
export function canonical(value: unknown): string {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return JSON.stringify(value);
    }
  }
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted((v as Record<string, unknown>)[k])])
        )
      : v;
  return JSON.stringify(sorted(parsed));
}

function tableParamsById(parameters: unknown): Map<string, TableParam> {
  const byId = new Map<string, TableParam>();
  if (Array.isArray(parameters)) for (const parameter of parameters) if (isTableParam(parameter)) byId.set(parameter.id, parameter);
  return byId;
}

/** The non-blank values stored for one parameter id; `stored` is an array of { id, value } or a legacy object keyed by id. */
function storedValuesFor(stored: unknown, id: string): unknown[] {
  let values: unknown[] = [];
  if (Array.isArray(stored)) {
    values = stored.filter((entry) => entry && typeof entry === 'object' && (entry as { id?: unknown }).id === id).flatMap((entry) => flattenValues((entry as { value?: unknown }).value));
  } else if (stored && typeof stored === 'object') {
    values = flattenValues((stored as Record<string, unknown>)[id]);
  }
  return values.filter((value) => !isBlank(value));
}

function refusal(param: TableParam, operation: string, message: string): BadRequestException {
  const name = typeof param.name === 'string' && param.name.trim() !== '' ? param.name : param.id;
  return new BadRequestException(`“${name}” on “${operation}”: ${message}`);
}

/**
 * Every Table value whose key is already stored on the node for that
 * parameter, replaced by the stored value. Pure: nothing is fetched.
 */
export function withStoredTableAnswers<E extends FormDataEntry>(parameters: unknown, formData: E[], stored: unknown): E[] {
  const params = tableParamsById(parameters);
  if (params.size === 0) return formData;
  return formData.map((entry) => {
    if (!params.has(entry.id)) return entry;
    const byKey = new Map<string, unknown>();
    for (const value of storedValuesFor(stored, entry.id)) {
      const key = sampleSheetKeyOf(value);
      if (key && !byKey.has(key)) byKey.set(key, value);
    }
    if (byKey.size === 0) return entry;
    const one = (value: unknown): unknown => {
      const key = isBlank(value) ? undefined : sampleSheetKeyOf(value);
      return key !== undefined && byKey.has(key) ? byKey.get(key) : value;
    };
    return { ...entry, value: Array.isArray(entry.value) ? entry.value.map(one) : one(entry.value) } as E;
  });
}

export interface CountNewTableAnswersInput {
  /** The operation's effective parameters, as the catalog has them now. */
  parameters: unknown;
  /** The answers about to be stored, hidden ones already removed. */
  formData: FormDataEntry[];
  /** The node's formData as stored, when the node exists. */
  stored?: unknown;
  /** The operation's label, for refusal messages. */
  operation: string;
  readObject: ReadObject;
  now?: () => Date;
}

async function countOne(param: TableParam, value: unknown, key: string | undefined, input: CountNewTableAnswersInput): Promise<string> {
  const refuse = (message: string): BadRequestException => refusal(param, input.operation, message);
  if (!key || !key.startsWith(TABLE_UPLOAD_KEY_PREFIX) || hasParentSegment(key)) throw refuse(TABLE_FILE_NOT_FETCHED_MESSAGE);
  if (!tableIsSetUp(param)) throw refuse(TABLE_NOT_SET_UP_MESSAGE);

  let buffer: Buffer;
  try {
    buffer = await input.readObject(key);
  } catch (error) {
    throw refuse(error instanceof ObjectTooLargeError ? TABLE_FILE_TOO_LARGE_MESSAGE : TABLE_FILE_NOT_FETCHED_MESSAGE);
  }

  let sampleCount: number;
  try {
    sampleCount = await checkTableFile(buffer, expectedColumns(param));
  } catch (error) {
    if (error instanceof TableFileError) throw refuse(error.message);
    throw error;
  }

  const meta = fileRecord(value) ?? {};
  return JSON.stringify({
    filename: typeof meta.filename === 'string' && meta.filename.trim() !== '' ? meta.filename : key.split('/').pop() ?? key,
    key,
    contentType: typeof meta.contentType === 'string' && meta.contentType !== '' ? meta.contentType : 'application/octet-stream',
    size: buffer.length,
    sampleCount,
    uploadedAt: typeof meta.uploadedAt === 'string' && meta.uploadedAt !== '' ? meta.uploadedAt : (input.now?.() ?? new Date()).toISOString(),
    // Built here and nowhere else: whatever the client sent under this name is not carried over.
    countedBy: SERVER_COUNTED
  });
}

/**
 * `formData` with every Table answer made safe to store: stored keys keep
 * their stored value, every other key is fetched, checked and counted. The
 * first refusal fails the whole call as a BadRequest naming the parameter and
 * the operation; nothing is written by this function.
 */
export async function countNewTableAnswers(input: CountNewTableAnswersInput): Promise<FormDataEntry[]> {
  const params = tableParamsById(input.parameters);
  if (params.size === 0) return input.formData;
  const formData = withStoredTableAnswers(input.parameters, input.formData, input.stored);
  const out: FormDataEntry[] = [];
  for (const entry of formData) {
    const param = params.get(entry.id);
    if (!param) {
      out.push(entry);
      continue;
    }
    const before = storedValuesFor(input.stored, entry.id);
    const storedKeys = new Set(before.map(sampleSheetKeyOf).filter((key): key is string => !!key));
    // A keyless value equal to a stored one is written back as stored, never re-read.
    const storedByCanonical = new Map(before.map((value) => [canonical(value), value] as const));
    const one = async (value: unknown): Promise<unknown> => {
      if (isBlank(value)) return value;
      const key = sampleSheetKeyOf(value);
      if (key) {
        if (storedKeys.has(key)) return value;
      } else if (storedByCanonical.has(canonical(value))) return storedByCanonical.get(canonical(value));
      return countOne(param, value, key, input);
    };
    if (Array.isArray(entry.value)) {
      const values: unknown[] = [];
      for (const value of entry.value) values.push(await one(value));
      out.push({ ...entry, value: values as FormDataEntry['value'] });
    } else {
      out.push({ ...entry, value: (await one(entry.value)) as FormDataEntry['value'] });
    }
  }
  return out;
}
