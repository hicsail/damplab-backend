import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { Sequence, ScreeningResult } from './types';
import { Region } from './types';
import { BatchScreeningInput, CreateSequenceInput } from './dtos/mpi.dto';
import { httpExceptionFromMpiAxiosError } from './mpi-http.util';
import { MAX_MPI_SEQUENCE_BATCH } from './mpi.constants';

/** No timeout — SecureDNA screening can run for a long time. */
const MPI_AXIOS_REQUEST_CONFIG = { timeout: 0 as const };

/** One element from MPI POST /secure-dna/screen (always returns an array) */
interface MpiScreeningItem {
  sequenceId: string;
  status: 'granted' | 'denied';
  threats?: unknown[];
  providerReference?: string | null;
  region?: string;
}

function formatThreatsFromMpi(threats: unknown[] | undefined): Array<{
  name: string;
  hit_regions: Array<{ seq: string; seq_range_start: number; seq_range_end: number }>;
  is_wild_type: boolean;
  references: string[];
}> {
  return (threats || []).map((threat: any) => ({
    name: threat.most_likely_organism?.name || 'Unknown Organism',
    hit_regions:
      threat.hit_regions?.map((region: any) => ({
        seq: region.seq,
        seq_range_start: region.seq_range_start,
        seq_range_end: region.seq_range_end
      })) || [],
    is_wild_type: threat.is_wild_type ?? false,
    references: threat.organisms?.map((org: any) => org.name) || []
  }));
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

  constructor(
    @InjectModel('Sequence') private sequenceModel: Model<Sequence>,
    @InjectModel('ScreeningResult') private screeningResultModel: Model<ScreeningResult>
  ) {}

  private async getServiceToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - this.TOKEN_REFRESH_THRESHOLD) {
      return this.cachedToken;
    }

    try {
      return await this.fetchServiceToken();
    } catch (error) {
      // Single retry: clear cache and try once more
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
      const mpiResponse = await axios.post(
        `${process.env.MPI_BACKEND}/sequences`,
        bodyForMpiCreateSequence(input),
        {
          ...MPI_AXIOS_REQUEST_CONFIG,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

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
      throw new HttpException(
        `At most ${MAX_MPI_SEQUENCE_BATCH} sequences per batch`,
        HttpStatus.BAD_REQUEST
      );
    }
    return Promise.all(inputs.map((input) => this.createSequence(input, userId)));
  }

  private async getSequence(id: string): Promise<Sequence | null> {
    const sequence = await this.sequenceModel.findOne({ _id: id, ...orgSequenceFilter() }).exec();
    if (!sequence) return null;
    return sequence;
  }

  private async saveScreeningResult(
    sequence: Sequence,
    mpiItem: MpiScreeningItem,
    region: Region,
    userId?: string
  ): Promise<ScreeningResult> {
    const formattedThreats = formatThreatsFromMpi(mpiItem.threats);
    const result = new this.screeningResultModel({
      sequence: sequence._id,
      region,
      status: mpiItem.status,
      threats: formattedThreats,
      userId: userId || sequence.userId,
      providerReference: mpiItem.providerReference ?? undefined
    });
    const savedResult = await result.save();
    const populatedResult = await this.screeningResultModel.findById(savedResult._id).populate('sequence').exec();

    if (!populatedResult) {
      throw new HttpException('Failed to retrieve populated screening result', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return populatedResult.toJSON() as unknown as ScreeningResult;
  }

  /**
   * All screening rows tied to org MPI sequences (M2M identity), not filtered by DAMPLab user.
   */
  async getOrgScreenings(): Promise<ScreeningResult[]> {
    const localScreenings = await this.screeningResultModel
      .find({})
      .populate({
        path: 'sequence',
        match: orgSequenceFilter()
      })
      .exec();

    const filtered = localScreenings.filter((s) => s.sequence != null);
    return filtered.map((screening) => screening.toJSON() as unknown as ScreeningResult);
  }

  async screenSequencesBatch(input: BatchScreeningInput, userId?: string): Promise<ScreeningResult[]> {
    const uniqueIds = [...new Set(input.sequenceIds)];
    if (uniqueIds.length > MAX_MPI_SEQUENCE_BATCH) {
      throw new HttpException(
        `At most ${MAX_MPI_SEQUENCE_BATCH} sequences per screening request`,
        HttpStatus.BAD_REQUEST
      );
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
      const items: MpiScreeningItem[] = Array.isArray(raw) ? raw : [raw];
      const byMpiId = new Map(valid.map((s) => [s.mpiId!, s]));
      const expectedMpiIds = new Set(valid.map((s) => s.mpiId!));

      for (const mpiItem of items) {
        if (!byMpiId.has(mpiItem.sequenceId)) {
          throw new HttpException(
            `MPI screening response included unknown sequence id: ${mpiItem.sequenceId}`,
            HttpStatus.BAD_GATEWAY
          );
        }
      }

      for (const mpiId of expectedMpiIds) {
        if (!items.some((it) => it.sequenceId === mpiId)) {
          throw new HttpException(
            `MPI screening response missing result for sequence id: ${mpiId}`,
            HttpStatus.BAD_GATEWAY
          );
        }
      }

      const saved: ScreeningResult[] = [];
      for (const mpiItem of items) {
        const sequence = byMpiId.get(mpiItem.sequenceId)!;
        const row = await this.saveScreeningResult(sequence, mpiItem, input.region, userId);
        saved.push(row);
      }

      return saved;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Error in screenSequencesBatch', error);
      throw httpExceptionFromMpiAxiosError(error, 'Failed to screen sequences in MPI');
    }
  }
}
