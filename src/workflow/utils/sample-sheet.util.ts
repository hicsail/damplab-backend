import { Job, JobState } from '../../job/job.model';

/**
 * A samples spreadsheet is a catalog parameter of type `sampleSheet`: staff
 * attach a blank template with the lab's columns, the customer downloads it,
 * fills it in and attaches it to the operation, and the number of rows below
 * the header is shown as the sample count.
 *
 * The count is informational. It is read in the browser when the file is
 * picked (`damplab-ui/src/utils/sampleSheet.ts`) and stored alongside the file's
 * key; nothing here prices on it. Should it ever bill, the count moves
 * server-side — do not start trusting the stored number for money.
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
