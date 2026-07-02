import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';
import axios from 'axios';
import { randomUUID } from 'crypto';
import type { Sequence } from './types';
import { ScreeningBatch } from './types';
import { Region } from './region';
import { BatchScreeningInput, CreateSequenceInput } from './dtos/securedna.dto';
import { httpExceptionFromAxiosError } from './axios-error.util';
import { MAX_SECUREDNA_SEQUENCE_BATCH } from './securedna.constants';

/** No timeout — SecureDNA screening can run for a long time. */
const SECUREDNA_AXIOS_REQUEST_CONFIG = { timeout: 0 as const };

interface SynthclientDiagnostic {
  diagnostic: string;
  additional_info: string;
  line_number_range?: [number, number] | number[] | null;
}

interface SynthclientRecordHit {
  fasta_header: string;
  line_number_range: number[];
  sequence_length: number;
  hits_by_hazard: unknown[];
}

interface SynthclientScreenResponse {
  synthesis_permission: 'granted' | 'denied';
  provider_reference?: string | null;
  hits_by_record?: SynthclientRecordHit[];
  warnings?: SynthclientDiagnostic[];
  errors?: SynthclientDiagnostic[];
  verifiable?: Record<string, unknown>;
}

function normalizeDiagnostic(d: SynthclientDiagnostic): {
  diagnostic: string;
  additional_info: string;
  line_number_range?: number[];
} {
  const lr = d.line_number_range;
  const out: { diagnostic: string; additional_info: string; line_number_range?: number[] } = {
    diagnostic: d.diagnostic,
    additional_info: d.additional_info
  };
  if (lr != null && Array.isArray(lr) && lr.length >= 2) {
    out.line_number_range = [Number(lr[0]), Number(lr[1])];
  }
  return out;
}

function assertSynthclientScreenResponse(raw: unknown): asserts raw is SynthclientScreenResponse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpException('SecureDNA synthclient returned an invalid response body', HttpStatus.BAD_GATEWAY);
  }
  const o = raw as Record<string, unknown>;
  if (o.synthesis_permission !== 'granted' && o.synthesis_permission !== 'denied') {
    throw new HttpException('SecureDNA response missing synthesis_permission', HttpStatus.BAD_GATEWAY);
  }
}

function normalizeSequenceValue(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeFastaHeader(header: string): string {
  return header
    .trim()
    .replace(/^>+\s*/, '')
    .trim();
}

function sequenceStableId(seq: Sequence): string {
  const s = seq as unknown as { id?: string; _id?: string };
  return String(s.id ?? s._id ?? '');
}

function mapHitsBySequenceId(sequenceIds: string[], hitsByRecord?: SynthclientRecordHit[]): Map<string, unknown[]> {
  const threatsById = new Map<string, unknown[]>(sequenceIds.map((id) => [id, []]));
  if (!hitsByRecord?.length) return threatsById;

  const idSet = new Set(sequenceIds);
  for (const record of hitsByRecord) {
    const normalized = normalizeFastaHeader(record.fasta_header);
    let targetId: string | undefined;
    if (idSet.has(normalized)) {
      targetId = normalized;
    } else {
      targetId = sequenceIds.find((id) => id === normalized || normalized.endsWith(id) || id.endsWith(normalized));
    }
    if (!targetId) continue;
    threatsById.set(targetId, record.hits_by_hazard ?? []);
  }
  return threatsById;
}

function secureDnaBaseUrl(): string {
  const raw = process.env.SECUREDNA_API_URL?.trim();
  if (!raw) {
    throw new HttpException('SecureDNA is not configured: set SECUREDNA_API_URL (e.g. http://127.0.0.1:8787 for local synthclient)', HttpStatus.SERVICE_UNAVAILABLE);
  }
  return raw.replace(/\/+$/, '');
}

@Injectable()
export class SecureDnaService {
  private readonly logger = new Logger(SecureDnaService.name);

  constructor(@InjectModel('Sequence') private sequenceModel: Model<Sequence & Document>, @InjectModel('ScreeningBatch') private screeningBatchModel: Model<Document>) {}

  async createSequence(input: CreateSequenceInput, userId?: string): Promise<Sequence> {
    const trimmedSeq = input.seq?.trim();
    if (!trimmedSeq) {
      throw new HttpException('Sequence cannot be empty', HttpStatus.BAD_REQUEST);
    }
    const now = new Date();
    const sequence = new this.sequenceModel({
      ...input,
      type: input.type || 'unknown',
      seq: trimmedSeq,
      annotations: input.annotations || [],
      userId: userId || 'system',
      created_at: now,
      updated_at: now
    });
    const savedSequence = await sequence.save();
    return savedSequence.toJSON() as unknown as Sequence;
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

  /** Ensure a local sequence document exists for job screening; update when sequence content changes. */
  async upsertSequenceForScreening(name: string, seq: string, userId: string): Promise<Sequence> {
    const trimmed = seq.trim();
    if (!trimmed.length) {
      throw new HttpException('Empty sequence', HttpStatus.BAD_REQUEST);
    }
    const existing = await this.sequenceModel.findOne({ name, userId }).exec();
    if (existing) {
      const prev = String(existing.seq ?? '');
      if (normalizeSequenceValue(prev) === normalizeSequenceValue(trimmed)) {
        return existing.toJSON() as unknown as Sequence;
      }
      const updated = await this.sequenceModel.findByIdAndUpdate(existing._id, { seq: trimmed, userId: userId || existing.userId, updated_at: new Date() }, { new: true }).exec();
      if (!updated) {
        throw new HttpException('Failed to update sequence', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      return updated.toJSON() as unknown as Sequence;
    }
    return this.createSequence({ name, type: 'dna', seq: trimmed }, userId);
  }

  private async getSequence(id: string): Promise<Sequence | null> {
    const sequence = await this.sequenceModel.findById(id).exec();
    if (!sequence) return null;
    return sequence.toJSON() as unknown as Sequence;
  }

  /**
   * All stored screening batches that reference at least one local sequence, newest first.
   * Not filtered by the calling user.
   */
  async listScreeningBatches(): Promise<ScreeningBatch[]> {
    const sequenceDocs = await this.sequenceModel.find().select('_id').lean().exec();
    const ids = sequenceDocs.map((s) => s._id);
    if (ids.length === 0) {
      return [];
    }

    const batches = await this.screeningBatchModel
      .find({ 'sequences.sequence': { $in: ids } })
      .populate('sequences.sequence')
      .sort({ createdAt: -1 })
      .exec();

    return batches.map((b) => b.toJSON() as unknown as ScreeningBatch);
  }

  async screenSequencesBatch(input: BatchScreeningInput, userId?: string): Promise<ScreeningBatch> {
    const uniqueIds = [...new Set(input.sequenceIds)];
    if (uniqueIds.length > MAX_SECUREDNA_SEQUENCE_BATCH) {
      throw new HttpException(`At most ${MAX_SECUREDNA_SEQUENCE_BATCH} sequences per screening request`, HttpStatus.BAD_REQUEST);
    }
    const sequences = await Promise.all(uniqueIds.map((id) => this.getSequence(id)));

    const missing = sequences.filter((s) => !s);
    if (missing.length > 0) {
      throw new HttpException('One or more sequences not found', HttpStatus.NOT_FOUND);
    }

    const valid = sequences.filter((s): s is Sequence => !!s);

    const body: Record<string, unknown> = {
      fasta: valid.map((s) => `>${sequenceStableId(s)}\n${String(s.seq ?? '')}`).join('\n'),
      region: input.region
    };
    if (input.providerReference?.trim()) {
      body.provider_reference = input.providerReference.trim();
    }

    try {
      const base = secureDnaBaseUrl();
      const screenResponse = await axios.post(`${base}/v1/screen`, body, {
        ...SECUREDNA_AXIOS_REQUEST_CONFIG,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const raw = screenResponse.data;
      assertSynthclientScreenResponse(raw);
      const data = raw;
      const ids = valid.map((s) => sequenceStableId(s));
      const threatsById = mapHitsBySequenceId(ids, data.hits_by_record);

      const sequenceSlices = valid.map((seq, order) => {
        const stableId = sequenceStableId(seq);
        // `getSequence` returns `toJSON()` which drops `_id` and sets `id` — use ObjectId from that id string.
        return {
          sequence: new Types.ObjectId(stableId),
          recordId: stableId,
          name: String((seq as unknown as { name?: string }).name ?? ''),
          order,
          originalSeq: String((seq as unknown as { seq?: string }).seq ?? ''),
          threats: threatsById.get(stableId) ?? []
        };
      });

      const created = await this.screeningBatchModel.create({
        batchRunId: `synthclient-${randomUUID()}`,
        screeningCompletedAt: new Date(),
        synthesisPermission: data.synthesis_permission,
        region: input.region as Region,
        providerReference: data.provider_reference ?? input.providerReference?.trim() ?? null,
        hitsByRecord: data.hits_by_record ?? [],
        warnings: (data.warnings ?? []).map(normalizeDiagnostic),
        errors: (data.errors ?? []).map(normalizeDiagnostic),
        verifiable: data.verifiable,
        sequences: sequenceSlices,
        userId: userId || String((valid[0] as unknown as { userId?: string }).userId)
      });

      const populated = await this.screeningBatchModel.findById(created._id).populate('sequences.sequence').exec();
      if (!populated) {
        throw new HttpException('Failed to load screening batch after save', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      return populated.toJSON() as unknown as ScreeningBatch;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (
        error !== null &&
        typeof error === 'object' &&
        'name' in error &&
        (error as { name?: string }).name === 'ValidationError'
      ) {
        this.logger.error('ScreeningBatch validation failed', error);
        throw new HttpException(
          'Failed to save screening batch (invalid sequence data)',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
      this.logger.error('Error in screenSequencesBatch', error);
      throw httpExceptionFromAxiosError(error, 'Failed to screen sequences via SecureDNA synthclient');
    }
  }
}
