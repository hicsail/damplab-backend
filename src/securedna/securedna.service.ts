import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Document, Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Region } from './region';
import { MAX_SECUREDNA_SEQUENCE_BATCH, SECUREDNA_REQUEST_TIMEOUT_MS } from './securedna.constants';
import type { ScreenSequencesArgs, ScreeningBatchRecord, ScreeningBatchSlice, ScreeningDiagnostic, ScreeningInputSequence, SynthclientRecordHit, SynthclientScreenResponse } from './types';
import { BatchScreeningInput, CreateSequenceInput } from './dtos/securedna.dto';
import type { Sequence } from './models/securedna-graphql.model';

/**
 * Talks to a SecureDNA synthclient over HTTP and stores what it says.
 *
 * `fetch`, not a client library: every other outbound integration here
 * (Keycloak, ClickUp, protocols, notification email) is plain fetch, and this
 * one call does not need more.
 *
 * Unreachable is not the same as denied. Anything that stops us getting an
 * answer — no URL configured, connection refused, a timeout, a malformed body —
 * raises, and the caller records the screening as unavailable. Only a real
 * `denied` from SecureDNA means a sequence failed.
 */

/** FASTA headers we generate, so a hit can be tied back to its slice by position. */
function fastaHeaderFor(order: number): string {
  return `s${order}`;
}

export function normalizeSequenceValue(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeFastaHeader(header: string): string {
  return header
    .trim()
    .replace(/^>+\s*/, '')
    .trim();
}

function normalizeDiagnostic(d: ScreeningDiagnostic): ScreeningDiagnostic {
  const out: ScreeningDiagnostic = {
    diagnostic: String(d?.diagnostic ?? ''),
    additional_info: String(d?.additional_info ?? '')
  };
  const lr = d?.line_number_range;
  if (Array.isArray(lr) && lr.length >= 2) {
    out.line_number_range = [Number(lr[0]), Number(lr[1])];
  }
  return out;
}

/**
 * SecureDNA echoes our FASTA header back on each record hit. Match on it, and
 * fall back to positional order for a synthclient that rewrites headers — a hit
 * we cannot place is worse than one placed by position, because an unplaced
 * hazard silently disappears from the slice it belongs to.
 */
export function mapHitsToSlices(sequences: ScreeningInputSequence[], hitsByRecord?: SynthclientRecordHit[]): unknown[][] {
  const threats: unknown[][] = sequences.map(() => []);
  if (!hitsByRecord?.length) return threats;

  const headerToIndex = new Map(sequences.map((_, i) => [fastaHeaderFor(i), i]));
  hitsByRecord.forEach((record, position) => {
    const header = normalizeFastaHeader(String(record?.fasta_header ?? ''));
    const index = headerToIndex.get(header) ?? (position < sequences.length ? position : undefined);
    if (index === undefined) return;
    threats[index] = Array.isArray(record?.hits_by_hazard) ? record.hits_by_hazard : [];
  });
  return threats;
}

function isSynthclientNotFoundBody(raw: object): boolean {
  const errors = (raw as Record<string, unknown>).errors;
  if (!Array.isArray(errors) || errors.length === 0) return false;
  return errors.some((e) => e && typeof e === 'object' && (e as { diagnostic?: unknown }).diagnostic === 'not_found');
}

export function assertSynthclientScreenResponse(raw: unknown): asserts raw is SynthclientScreenResponse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpException('SecureDNA returned an invalid response body', HttpStatus.BAD_GATEWAY);
  }
  const permission = (raw as Record<string, unknown>).synthesis_permission;
  if (permission !== 'granted' && permission !== 'denied') {
    throw new HttpException('SecureDNA response missing synthesis_permission', HttpStatus.BAD_GATEWAY);
  }
  // Unknown paths come back 200 with denied + not_found. That is a routing miss,
  // not a hazard — JobScreeningService maps this throw to UNAVAILABLE.
  if (isSynthclientNotFoundBody(raw)) {
    throw new HttpException(
      'SecureDNA returned not_found — set SECUREDNA_API_URL to the synthclient origin (e.g. http://127.0.0.1:8787), not a path',
      HttpStatus.BAD_GATEWAY
    );
  }
}

export function buildFasta(sequences: ScreeningInputSequence[]): string {
  return sequences.map((s, i) => `>${fastaHeaderFor(i)}\n${normalizeSequenceValue(s.seq)}`).join('\n');
}

function asGraphqlSequence(doc: { toJSON?: () => unknown } | Record<string, unknown>): Sequence {
  const raw = typeof (doc as { toJSON?: () => unknown }).toJSON === 'function' ? (doc as { toJSON: () => unknown }).toJSON() : doc;
  const s = raw as Record<string, unknown> & { _id?: { toString: () => string } };
  return {
    id: String(s.id ?? s._id ?? ''),
    name: String(s.name ?? ''),
    type: (s.type as Sequence['type']) || 'unknown',
    seq: String(s.seq ?? ''),
    annotations: (s.annotations as Sequence['annotations']) || [],
    userId: String(s.userId ?? ''),
    created_at: s.created_at as Date,
    updated_at: s.updated_at as Date
  };
}

/**
 * Standalone batches send Mongo ids as FASTA headers. Match on the echoed
 * header, then fall back to position, same as job slices.
 */
export function mapHitsBySequenceId(sequenceIds: string[], hitsByRecord?: SynthclientRecordHit[]): unknown[][] {
  const threats: unknown[][] = sequenceIds.map(() => []);
  if (!hitsByRecord?.length) return threats;
  const headerToIndex = new Map(sequenceIds.map((id, i) => [id, i]));
  hitsByRecord.forEach((record, position) => {
    const header = normalizeFastaHeader(String(record?.fasta_header ?? ''));
    const index = headerToIndex.get(header) ?? (position < sequenceIds.length ? position : undefined);
    if (index === undefined) return;
    threats[index] = Array.isArray(record?.hits_by_hazard) ? record.hits_by_hazard : [];
  });
  return threats;
}

@Injectable()
export class SecureDnaService {
  private readonly logger = new Logger(SecureDnaService.name);

  constructor(
    @InjectModel('ScreeningBatch') private readonly screeningBatchModel: Model<Document>,
    @InjectModel('Sequence') private readonly sequenceModel: Model<Document>
  ) {}

  /** True when a synthclient URL is configured at all. */
  isConfigured(): boolean {
    return Boolean(process.env.SECUREDNA_API_URL?.trim());
  }

  private baseUrl(): string {
    const raw = process.env.SECUREDNA_API_URL?.trim();
    if (!raw) {
      throw new HttpException('SecureDNA is not configured: set SECUREDNA_API_URL (e.g. http://127.0.0.1:8787 for a local synthclient)', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return raw.replace(/\/+$/, '');
  }

  private timeoutMs(): number {
    const raw = Number(process.env.SECUREDNA_REQUEST_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : SECUREDNA_REQUEST_TIMEOUT_MS;
  }

  private async postScreen(body: Record<string, unknown>): Promise<SynthclientScreenResponse> {
    const url = `${this.baseUrl()}/v1/screen`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs())
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpException(`Could not reach SecureDNA at ${url}: ${reason}`, HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new HttpException(`SecureDNA returned ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`, HttpStatus.BAD_GATEWAY);
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new HttpException('SecureDNA returned a body that is not JSON', HttpStatus.BAD_GATEWAY);
    }
    assertSynthclientScreenResponse(parsed);
    return parsed;
  }

  /**
   * Screen one set of sequences and store the result as a batch.
   *
   * Raises rather than returning a verdict when SecureDNA cannot be reached:
   * callers must not read a transport failure as a pass or a fail.
   */
  async screenSequences(args: ScreenSequencesArgs): Promise<ScreeningBatchRecord> {
    const { sequences, userId } = args;
    if (sequences.length === 0) {
      throw new HttpException('No sequences to screen', HttpStatus.BAD_REQUEST);
    }
    if (sequences.length > MAX_SECUREDNA_SEQUENCE_BATCH) {
      throw new HttpException(`At most ${MAX_SECUREDNA_SEQUENCE_BATCH} sequences per screening request`, HttpStatus.BAD_REQUEST);
    }

    const region = args.region ?? Region.ALL;
    const body: Record<string, unknown> = { fasta: buildFasta(sequences), region };
    if (args.providerReference?.trim()) {
      body.provider_reference = args.providerReference.trim();
    }

    const data = await this.postScreen(body);
    const threats = mapHitsToSlices(sequences, data.hits_by_record);
    const slices: ScreeningBatchSlice[] = sequences.map((s, order) => ({
      name: s.name,
      order,
      originalSeq: s.seq,
      threats: threats[order] ?? []
    }));

    const created = await this.screeningBatchModel.create({
      batchRunId: `synthclient-${randomUUID()}`,
      screeningCompletedAt: new Date(),
      synthesisPermission: data.synthesis_permission,
      region,
      providerReference: data.provider_reference ?? args.providerReference?.trim() ?? null,
      hitsByRecord: data.hits_by_record ?? [],
      warnings: (data.warnings ?? []).map(normalizeDiagnostic),
      errors: (data.errors ?? []).map(normalizeDiagnostic),
      verifiable: data.verifiable,
      sequences: slices,
      jobId: args.jobId ? new mongoose.Types.ObjectId(args.jobId) : undefined,
      userId
    });

    return {
      id: String(created._id),
      batchRunId: String((created as unknown as { batchRunId: string }).batchRunId),
      screeningCompletedAt: (created as unknown as { screeningCompletedAt: Date }).screeningCompletedAt,
      synthesisPermission: data.synthesis_permission,
      region,
      providerReference: (created as unknown as { providerReference: string | null }).providerReference ?? null,
      warnings: (data.warnings ?? []).map(normalizeDiagnostic),
      errors: (data.errors ?? []).map(normalizeDiagnostic),
      sequences: slices
    };
  }

  async findBatchById(id: string): Promise<Record<string, unknown> | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return this.screeningBatchModel.findById(id).lean().exec() as Promise<Record<string, unknown> | null>;
  }

  async createSequence(input: CreateSequenceInput, userId?: string): Promise<Sequence> {
    const trimmedSeq = input.seq?.trim();
    if (!trimmedSeq) {
      throw new HttpException('Sequence cannot be empty', HttpStatus.BAD_REQUEST);
    }
    const now = new Date();
    const saved = await this.sequenceModel.create({
      ...input,
      type: input.type || 'unknown',
      seq: trimmedSeq,
      annotations: input.annotations || [],
      userId: userId || 'system',
      created_at: now,
      updated_at: now
    });
    return asGraphqlSequence(saved);
  }

  async createSequencesBatch(inputs: CreateSequenceInput[], userId?: string): Promise<Sequence[]> {
    if (inputs.length === 0) {
      throw new HttpException('No sequences to create', HttpStatus.BAD_REQUEST);
    }
    if (inputs.length > MAX_SECUREDNA_SEQUENCE_BATCH) {
      throw new HttpException(`At most ${MAX_SECUREDNA_SEQUENCE_BATCH} sequences per batch`, HttpStatus.BAD_REQUEST);
    }
    return Promise.all(inputs.map((input) => this.createSequence(input, userId)));
  }

  /**
   * Standalone screener history: batches that reference stored Sequence docs.
   * Job homology runs are omitted so they do not clutter this page.
   */
  async listScreeningBatches(): Promise<Record<string, unknown>[]> {
    const sequenceDocs = await this.sequenceModel.find().select('_id').lean().exec();
    const ids = sequenceDocs.map((s) => (s as { _id: unknown })._id);
    if (ids.length === 0) {
      return [];
    }

    const batches = await this.screeningBatchModel
      .find({ 'sequences.sequence': { $in: ids } })
      .populate('sequences.sequence')
      .sort({ createdAt: -1 })
      .exec();

    return batches.map((b) => (b as unknown as { toJSON: () => Record<string, unknown> }).toJSON());
  }

  async screenSequencesBatch(input: BatchScreeningInput, userId?: string): Promise<Record<string, unknown>> {
    const uniqueIds = [...new Set(input.sequenceIds)];
    if (uniqueIds.length === 0) {
      throw new HttpException('No sequences to screen', HttpStatus.BAD_REQUEST);
    }
    if (uniqueIds.length > MAX_SECUREDNA_SEQUENCE_BATCH) {
      throw new HttpException(`At most ${MAX_SECUREDNA_SEQUENCE_BATCH} sequences per screening request`, HttpStatus.BAD_REQUEST);
    }

    const docs = await Promise.all(uniqueIds.map((id) => this.sequenceModel.findById(id).exec()));
    if (docs.some((d) => !d)) {
      throw new HttpException('One or more sequences not found', HttpStatus.NOT_FOUND);
    }
    const sequences = docs.map((d) => asGraphqlSequence(d as Document));

    const body: Record<string, unknown> = {
      fasta: sequences.map((s) => `>${s.id}\n${normalizeSequenceValue(s.seq)}`).join('\n'),
      region: input.region
    };
    if (input.providerReference?.trim()) {
      body.provider_reference = input.providerReference.trim();
    }

    const data = await this.postScreen(body);
    const ids = sequences.map((s) => s.id);
    const threats = mapHitsBySequenceId(ids, data.hits_by_record);

    const sequenceSlices = sequences.map((seq, order) => ({
      sequence: new mongoose.Types.ObjectId(seq.id),
      recordId: seq.id,
      name: seq.name,
      order,
      originalSeq: seq.seq,
      threats: threats[order] ?? []
    }));

    const created = await this.screeningBatchModel.create({
      batchRunId: `synthclient-${randomUUID()}`,
      screeningCompletedAt: new Date(),
      synthesisPermission: data.synthesis_permission,
      region: input.region,
      providerReference: data.provider_reference ?? input.providerReference?.trim() ?? null,
      hitsByRecord: data.hits_by_record ?? [],
      warnings: (data.warnings ?? []).map(normalizeDiagnostic),
      errors: (data.errors ?? []).map(normalizeDiagnostic),
      verifiable: data.verifiable,
      sequences: sequenceSlices,
      userId: userId || sequences[0]?.userId || 'system'
    });

    const populated = await this.screeningBatchModel.findById(created._id).populate('sequences.sequence').exec();
    if (!populated) {
      throw new HttpException('Failed to load screening batch after save', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return (populated as unknown as { toJSON: () => Record<string, unknown> }).toJSON();
  }
}
