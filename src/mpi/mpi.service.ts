import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { Sequence } from './types';
import { Region } from './types';
import { ScreeningBatch } from './models/mpi.model';
import { BatchScreeningInput, CreateSequenceInput } from './dtos/mpi.dto';
import { httpExceptionFromMpiAxiosError } from './mpi-http.util';
import { MAX_MPI_SEQUENCE_BATCH } from './mpi.constants';

/** No timeout — SecureDNA screening can run for a long time. */
const MPI_AXIOS_REQUEST_CONFIG = { timeout: 0 as const };

interface MpiDiagnostic {
  diagnostic: string;
  additional_info: string;
  line_number_range?: [number, number] | number[] | null;
}

interface MpiPassthroughRecordHit {
  fasta_header: string;
  line_number_range: number[];
  sequence_length: number;
  hits_by_hazard: unknown[];
}

interface MpiPassthroughResponse {
  synthesis_permission: 'granted' | 'denied';
  provider_reference?: string | null;
  hits_by_record?: MpiPassthroughRecordHit[];
  warnings?: MpiDiagnostic[];
  errors?: MpiDiagnostic[];
  verifiable?: Record<string, unknown>;
}

function normalizeDiagnostic(d: MpiDiagnostic): {
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

function assertPassthroughResponse(raw: unknown): asserts raw is MpiPassthroughResponse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpException('MPI screening returned an invalid response body', HttpStatus.BAD_GATEWAY);
  }
  const o = raw as Record<string, unknown>;
  if (o.synthesis_permission !== 'granted' && o.synthesis_permission !== 'denied') {
    throw new HttpException('MPI passthrough response missing synthesis_permission', HttpStatus.BAD_GATEWAY);
  }
}

/** M2M auth maps to one MPI org user; only list sequences registered with MPI (mpiId). */
function orgSequenceFilter(): Record<string, unknown> {
  return { mpiId: { $exists: true, $nin: [null, ''] } };
}

function normalizeSequenceValue(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeFastaHeader(header: string): string {
  return header.trim().replace(/^>+\s*/, '').trim();
}

function sequenceStableId(seq: Sequence): string {
  const s = seq as unknown as { id?: string; _id?: string };
  return String(s.id ?? s._id ?? '');
}

function mapHitsBySequenceId(sequenceIds: string[], hitsByRecord?: MpiPassthroughRecordHit[]): Map<string, unknown[]> {
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

/**
 * MPI Prisma `Annotation` uses `name`, not `description`. DAMPLab GraphQL uses `description`
 * for feature labels; map so MPI create succeeds while we still persist the original shape locally.
 */
function bodyForMpiCreateSequence(input: CreateSequenceInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.name,
    type: input.type,
    seq: input.seq
  };
  if (input.annotations?.length) {
    body.annotations = input.annotations.map((a) => ({
      start: a.start,
      end: a.end,
      type: a.type,
      name: (a.description?.trim() || a.type || 'feature').slice(0, 500)
    }));
  }
  return body;
}

@Injectable()
export class MPIService {
  private readonly logger = new Logger(MPIService.name);
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;
  private readonly TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000;

  constructor(@InjectModel('Sequence') private sequenceModel: Model<Sequence>, @InjectModel('ScreeningBatch') private screeningBatchModel: Model<Document>) {}

  private async getServiceToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - this.TOKEN_REFRESH_THRESHOLD) {
      return this.cachedToken;
    }

    try {
      return await this.fetchServiceToken();
    } catch (error) {
      this.cachedToken = null;
      this.tokenExpiresAt = 0;
      return await this.fetchServiceToken();
    }
  }

  private async fetchServiceToken(): Promise<string> {
    try {
      const response = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
        grant_type: 'client_credentials',
        client_id: process.env.MPI_M2M_CLIENT_ID,
        client_secret: process.env.MPI_M2M_CLIENT_SECRET,
        audience: process.env.AUTH0_AUDIENCE
      });

      const token = response.data.access_token;
      this.cachedToken = token;
      this.tokenExpiresAt = Date.now() + response.data.expires_in * 1000;
      return token;
    } catch (error) {
      throw httpExceptionFromMpiAxiosError(error, 'Failed to obtain MPI service token');
    }
  }

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
      // Kept for backward compatibility with existing schema/queries.
      mpiId: `local-${randomUUID()}`,
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
    if (inputs.length > MAX_MPI_SEQUENCE_BATCH) {
      throw new HttpException(`At most ${MAX_MPI_SEQUENCE_BATCH} sequences per batch`, HttpStatus.BAD_REQUEST);
    }
    return Promise.all(inputs.map((input) => this.createSequence(input, userId)));
  }

  /** Ensure a local sequence exists for job screening and update content when changed. */
  async upsertSequenceForScreening(name: string, seq: string, userId: string): Promise<Sequence> {
    const trimmed = seq.trim();
    if (!trimmed.length) {
      throw new HttpException('Empty sequence', HttpStatus.BAD_REQUEST);
    }
    const existing = await this.sequenceModel.findOne({ name, ...orgSequenceFilter() }).exec();
    if (existing) {
      const prev = String(existing.seq ?? '');
      if (normalizeSequenceValue(prev) === normalizeSequenceValue(trimmed)) {
        return existing.toJSON() as unknown as Sequence;
      }
      const updated = await this.sequenceModel
        .findByIdAndUpdate(existing._id, { seq: trimmed, userId: userId || existing.userId, updated_at: new Date() }, { new: true })
        .exec();
      if (!updated) {
        throw new HttpException('Failed to update sequence', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      return updated.toJSON() as unknown as Sequence;
    }
    return this.createSequence({ name, type: 'dna', seq: trimmed }, userId);
  }

  private async getSequence(id: string): Promise<Sequence | null> {
    const sequence = await this.sequenceModel.findOne({ _id: id, ...orgSequenceFilter() }).exec();
    if (!sequence) return null;
    return sequence;
  }

  /**
   * All screening batches that include at least one org MPI sequence (M2M identity), not filtered by DAMPLab user.
   */
  async getOrgScreenings(): Promise<ScreeningBatch[]> {
    const orgSequences = await this.sequenceModel.find(orgSequenceFilter()).select('_id').lean().exec();
    const ids = orgSequences.map((s) => s._id);
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
    if (uniqueIds.length > MAX_MPI_SEQUENCE_BATCH) {
      throw new HttpException(`At most ${MAX_MPI_SEQUENCE_BATCH} sequences per screening request`, HttpStatus.BAD_REQUEST);
    }
    const sequences = await Promise.all(uniqueIds.map((id) => this.getSequence(id)));

    const missing = sequences.filter((s) => !s);
    if (missing.length > 0) {
      throw new HttpException('One or more sequences not found', HttpStatus.NOT_FOUND);
    }

    const valid = sequences.filter((s): s is Sequence => !!s);

    const token = await this.getServiceToken();

    const body: Record<string, unknown> = {
      fasta: valid.map((s) => `>${sequenceStableId(s)}\n${String(s.seq ?? '')}`).join('\n'),
      region: input.region
    };
    if (input.providerReference?.trim()) {
      body.provider_reference = input.providerReference.trim();
    }

    try {
      const mpiResponse = await axios.post(`${process.env.MPI_BACKEND}/secure-dna/screen/passthrough`, body, {
        ...MPI_AXIOS_REQUEST_CONFIG,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const raw = mpiResponse.data;
      assertPassthroughResponse(raw);
      const data = raw;
      const ids = valid.map((s) => sequenceStableId(s));
      const threatsById = mapHitsBySequenceId(ids, data.hits_by_record);

      const sequenceSlices = valid.map((seq, order) => {
        const stableId = sequenceStableId(seq);
        return {
          sequence: (seq as unknown as { _id: unknown })._id,
          mpiSequenceId: stableId,
          name: String((seq as unknown as { name?: string }).name ?? ''),
          order,
          originalSeq: String((seq as unknown as { seq?: string }).seq ?? ''),
          threats: threatsById.get(stableId) ?? []
        };
      });

      const created = await this.screeningBatchModel.create({
        mpiBatchId: `passthrough-${randomUUID()}`,
        mpiCreatedAt: new Date(),
        synthesisPermission: data.synthesis_permission,
        region: input.region as Region,
        providerReference: data.provider_reference ?? input.providerReference?.trim() ?? null,
        hitsByRecord: data.hits_by_record ?? [],
        warnings: (data.warnings ?? []).map(normalizeDiagnostic),
        errors: (data.errors ?? []).map(normalizeDiagnostic),
        verifiable: data.verifiable,
        sequences: sequenceSlices,
        userId: userId || valid[0].userId
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
      this.logger.error('Error in screenSequencesBatch', error);
      throw httpExceptionFromMpiAxiosError(error, 'Failed to screen sequences in MPI passthrough');
    }
  }
}
