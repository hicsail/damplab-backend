import { Job, JobState } from '../../job/job.model';

/**
 * A samples spreadsheet is a catalog parameter of type `sampleSheet`: staff
 * attach a blank template with the lab's columns, the customer downloads it,
 * fills it in and attaches it to the operation, and the number of rows below
 * the header is shown as the sample count.
 *
 * The count is read in the browser when the file is picked
 * (`damplab-ui/src/utils/sampleSheet.ts`) and stored alongside the file's key.
 * On an operation priced "by parameter" it is the quantity the parameter's
 * price is multiplied by — see `sampleCountFromValue` below for what that
 * means for trust.
 *
 * The stored value is a JSON string in the node's formData, the same shape as a
 * `file` parameter plus `sampleCount`, so everything that already reads file
 * parameters (the download presign in the node resolver, the job pages, the
 * job editor) keeps working unchanged.
 */
export const SAMPLE_SHEET_PARAM_TYPE = 'sampleSheet';

/** Where blank templates live. A template download presigns only keys under here. */
export const SAMPLE_SHEET_TEMPLATE_KEY_PREFIX = 'sample-sheet-templates/';

export interface SampleSheetTemplateFile {
  key: string;
  filename?: string;
  contentType?: string;
  size?: number;
}

export interface SampleSheetParam {
  id: string;
  type: typeof SAMPLE_SHEET_PARAM_TYPE;
  name?: string;
  templateFile?: SampleSheetTemplateFile | null;
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

export const isSampleSheetParam = (param: unknown): param is SampleSheetParam =>
  !!param && typeof param === 'object' && (param as { type?: unknown }).type === SAMPLE_SHEET_PARAM_TYPE && typeof (param as { id?: unknown }).id === 'string';

export function findSampleSheetParam(parameters: unknown, parameterId: string): SampleSheetParam | null {
  if (!Array.isArray(parameters)) return null;
  const match = parameters.find((param) => isSampleSheetParam(param) && param.id === parameterId);
  return match ? (match as SampleSheetParam) : null;
}

/** The template key on a parameter, or null when there is none or it is not a template key. */
export function templateKeyOf(param: SampleSheetParam | null): string | null {
  const key = param?.templateFile?.key;
  if (typeof key !== 'string' || !key.startsWith(SAMPLE_SHEET_TEMPLATE_KEY_PREFIX)) return null;
  return key;
}

/**
 * The prefix `createWorkflowParameterUploadUrls` mints keys under for this
 * caller. A replacement must name a key under the caller's own prefix, because
 * the node resolver presigns a download for whatever key is stored — accepting
 * a foreign key would let the writer read someone else's upload.
 */
export function uploadKeyPrefixFor(userSub: string | undefined): string {
  return `workflow-parameters/${userSub ?? 'anonymous'}/`;
}

export function keyBelongsToUploader(key: string, userSub: string | undefined): boolean {
  return typeof key === 'string' && key.startsWith(uploadKeyPrefixFor(userSub)) && !key.includes('..');
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
