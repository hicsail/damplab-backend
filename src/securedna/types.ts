import { Region } from './region';

/** One sequence handed to SecureDNA, and the slice it becomes on the stored batch. */
export interface ScreeningInputSequence {
  /** `<workflowId>_<nodeId>_<fieldId>` — see job-screening-name.util. */
  name: string;
  seq: string;
}

export interface ScreeningDiagnostic {
  diagnostic: string;
  additional_info: string;
  line_number_range?: number[];
}

/** SecureDNA synthclient `POST /v1/screen` response, as far as we rely on it. */
export interface SynthclientScreenResponse {
  synthesis_permission: 'granted' | 'denied';
  provider_reference?: string | null;
  hits_by_record?: SynthclientRecordHit[];
  warnings?: ScreeningDiagnostic[];
  errors?: ScreeningDiagnostic[];
  verifiable?: Record<string, unknown>;
}

export interface SynthclientRecordHit {
  fasta_header: string;
  line_number_range?: number[];
  sequence_length?: number;
  hits_by_hazard?: unknown[];
}

export interface ScreeningBatchSlice {
  name: string;
  order: number;
  originalSeq: string;
  threats: unknown[];
}

export interface ScreeningBatchRecord {
  id: string;
  batchRunId: string;
  screeningCompletedAt: Date;
  synthesisPermission: 'granted' | 'denied';
  region: Region;
  providerReference: string | null;
  warnings: ScreeningDiagnostic[];
  errors: ScreeningDiagnostic[];
  sequences: ScreeningBatchSlice[];
}

export interface ScreenSequencesArgs {
  sequences: ScreeningInputSequence[];
  region?: Region;
  providerReference?: string;
  /** The job this run belongs to, so a batch can be found without walking Job. */
  jobId?: string;
  userId: string;
}
