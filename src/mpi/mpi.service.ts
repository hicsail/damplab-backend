import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import axios from 'axios';
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

interface MpiScreeningBatchResponse {
  id: string;
  createdAt: string | Date;
  synthesisPermission: 'granted' | 'denied';
  region: string;
  providerReference?: string | null;
  hitsByRecord?: unknown[];
  warnings?: MpiDiagnostic[];
  errors?: MpiDiagnostic[];
  verifiable?: Record<string, unknown>;
  sequences: Array<{
    sequenceId: string;
    name: string;
    order: number;
    originalSeq: string;
    threats: unknown[];
    warning?: string;
  }>;
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

function assertScreeningBatchResponse(raw: unknown): asserts raw is MpiScreeningBatchResponse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpException('MPI screening returned an invalid response body', HttpStatus.BAD_GATEWAY);
  }
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.sequences)) {
    throw new HttpException('MPI screening response missing sequences array', HttpStatus.BAD_GATEWAY);
  }
}

/** M2M auth maps to one MPI org user; only list sequences registered with MPI (mpiId). */
function orgSequenceFilter(): Record<string, unknown> {
  return { mpiId: { $exists: true, $nin: [null, ''] } };
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
    const token = await this.getServiceToken();

    try {
      const mpiResponse = await axios.post(`${process.env.MPI_BACKEND}/sequences`, bodyForMpiCreateSequence(input), {
        ...MPI_AXIOS_REQUEST_CONFIG,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const now = new Date();
      const sequence = new this.sequenceModel({
        ...input,
        type: input.type || 'unknown',
        annotations: input.annotations || [],
        userId: userId || 'system',
        mpiId: mpiResponse.data.id,
        created_at: now,
        updated_at: now
      });
      const savedSequence = await sequence.save();
      return savedSequence.toJSON() as unknown as Sequence;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to create sequence in MPI', error);
      throw httpExceptionFromMpiAxiosError(error, 'Failed to create sequence in MPI');
    }
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

  /**
   * Ensure a local MPI-backed sequence exists with the given stable name and current seq (job screening).
   * Updates MPI + Mongo when the sequence content changes; keeps the same Mongo _id so history stays valid.
   */
  async upsertSequenceForScreening(name: string, seq: string, userId: string): Promise<Sequence> {
    const trimmed = seq.trim();
    if (!trimmed.length) {
      throw new HttpException('Empty sequence', HttpStatus.BAD_REQUEST);
    }
    const existing = await this.sequenceModel.findOne({ name, ...orgSequenceFilter() }).exec();
    if (existing) {
      const prev = String(existing.seq ?? '');
      if (prev.trim().toUpperCase().replace(/\s+/g, '') === trimmed.toUpperCase().replace(/\s+/g, '')) {
        return existing.toJSON() as unknown as Sequence;
      }
      return this.replaceSequenceSequence(existing as unknown as Record<string, unknown> & { _id?: unknown; mpiId?: string }, trimmed, userId);
    }
    return this.createSequence({ name, type: 'dna', seq: trimmed }, userId);
  }

  private async replaceSequenceSequence(existing: Record<string, unknown> & { _id?: unknown; mpiId?: string }, newSeq: string, userId: string): Promise<Sequence> {
    const mpiId = existing.mpiId as string;
    const token = await this.getServiceToken();
    const url = `${process.env.MPI_BACKEND}/sequences/${encodeURIComponent(mpiId)}`;
    try {
      await axios.patch(
        url,
        { seq: newSeq },
        {
          ...MPI_AXIOS_REQUEST_CONFIG,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const updated = await this.sequenceModel
        .findByIdAndUpdate(existing._id, { seq: newSeq, updated_at: new Date() }, { new: true })
        .exec();
      if (!updated) {
        throw new HttpException('Failed to update sequence after MPI patch', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      return updated.toJSON() as unknown as Sequence;
    } catch (patchErr) {
      this.logger.warn(`MPI sequence PATCH failed for ${mpiId}; creating a new MPI sequence and re-linking`, patchErr);
      return this.recreateMpiSequenceForExistingDoc(existing, newSeq, userId);
    }
  }

  private async recreateMpiSequenceForExistingDoc(
    existing: Record<string, unknown> & { _id?: unknown; name?: string; type?: string },
    newSeq: string,
    userId: string
  ): Promise<Sequence> {
    const token = await this.getServiceToken();
    const body = bodyForMpiCreateSequence({
      name: String(existing.name ?? ''),
      type: (existing.type as 'dna' | 'rna' | 'aa' | 'unknown') || 'dna',
      seq: newSeq
    });
    const mpiResponse = await axios.post(`${process.env.MPI_BACKEND}/sequences`, body, {
      ...MPI_AXIOS_REQUEST_CONFIG,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const updated = await this.sequenceModel
      .findByIdAndUpdate(
        existing._id,
        {
          mpiId: mpiResponse.data.id,
          seq: newSeq,
          userId: userId || (existing.userId as string) || 'system',
          updated_at: new Date()
        },
        { new: true }
      )
      .exec();
    if (!updated) {
      throw new HttpException('Failed to re-link sequence after MPI recreate', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return updated.toJSON() as unknown as Sequence;
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
    const missingMpi = valid.filter((s) => !s.mpiId);
    if (missingMpi.length > 0) {
      throw new HttpException('One or more sequences are missing MPI id', HttpStatus.BAD_REQUEST);
    }

    const token = await this.getServiceToken();

    const body: Record<string, unknown> = {
      sequenceIds: valid.map((s) => s.mpiId!),
      region: input.region
    };
    if (input.providerReference?.trim()) {
      body.provider_reference = input.providerReference.trim();
    }

    try {
      const mpiResponse = await axios.post(`${process.env.MPI_BACKEND}/secure-dna/screen`, body, {
        ...MPI_AXIOS_REQUEST_CONFIG,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const raw = mpiResponse.data;
      assertScreeningBatchResponse(raw);
      const data = raw;

      const byMpiId = new Map(valid.map((s) => [s.mpiId!, s]));
      const expectedMpiIds = new Set(valid.map((s) => s.mpiId!));
      const sliceIds = new Set(data.sequences.map((s) => s.sequenceId));

      if (data.sequences.length !== expectedMpiIds.size) {
        throw new HttpException(`MPI screening sequences count (${data.sequences.length}) does not match request (${expectedMpiIds.size})`, HttpStatus.BAD_GATEWAY);
      }

      for (const mpiId of expectedMpiIds) {
        if (!sliceIds.has(mpiId)) {
          throw new HttpException(`MPI screening response missing slice for sequence id: ${mpiId}`, HttpStatus.BAD_GATEWAY);
        }
      }

      for (const sid of sliceIds) {
        if (!byMpiId.has(sid)) {
          throw new HttpException(`MPI screening response included unknown sequence id: ${sid}`, HttpStatus.BAD_GATEWAY);
        }
      }

      const sequenceSlices = data.sequences.map((slice) => {
        const seq = byMpiId.get(slice.sequenceId)!;
        return {
          sequence: seq._id,
          mpiSequenceId: slice.sequenceId,
          name: slice.name,
          order: slice.order,
          originalSeq: slice.originalSeq,
          threats: slice.threats ?? [],
          ...(slice.warning ? { warning: slice.warning } : {})
        };
      });

      const created = await this.screeningBatchModel.create({
        mpiBatchId: data.id,
        mpiCreatedAt: new Date(data.createdAt),
        synthesisPermission: data.synthesisPermission,
        region: input.region as Region,
        providerReference: data.providerReference ?? null,
        hitsByRecord: data.hitsByRecord ?? [],
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
      throw httpExceptionFromMpiAxiosError(error, 'Failed to screen sequences in MPI');
    }
  }
}
