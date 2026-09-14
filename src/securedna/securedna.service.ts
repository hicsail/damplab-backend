import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Document, Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Region } from './region';
import { MAX_SECUREDNA_SEQUENCE_BATCH, SECUREDNA_REQUEST_TIMEOUT_MS } from './securedna.constants';
import type { ScreenSequencesArgs, ScreeningBatchRecord, ScreeningBatchSlice, ScreeningDiagnostic, ScreeningInputSequence, SynthclientRecordHit, SynthclientScreenResponse } from './types';

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

export function assertSynthclientScreenResponse(raw: unknown): asserts raw is SynthclientScreenResponse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpException('SecureDNA returned an invalid response body', HttpStatus.BAD_GATEWAY);
  }
  const permission = (raw as Record<string, unknown>).synthesis_permission;
  if (permission !== 'granted' && permission !== 'denied') {
    throw new HttpException('SecureDNA response missing synthesis_permission', HttpStatus.BAD_GATEWAY);
  }
}

export function buildFasta(sequences: ScreeningInputSequence[]): string {
  return sequences.map((s, i) => `>${fastaHeaderFor(i)}\n${normalizeSequenceValue(s.seq)}`).join('\n');
}

@Injectable()
export class SecureDnaService {
  private readonly logger = new Logger(SecureDnaService.name);

  constructor(@InjectModel('ScreeningBatch') private readonly screeningBatchModel: Model<Document>) {}

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
}
