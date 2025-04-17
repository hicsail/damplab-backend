import { Injectable, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { Sequence, ScreeningResult, HazardHits } from './types';
import { TokenStore, TokenStoreDocument } from './models/token-store.model';
import { ScreeningInput, Region } from './types';
import { JwtService } from '@nestjs/jwt';
import { CreateSequenceInput } from './dtos/mpi.dto';

const TOKEN_STORE_MODEL = 'TokenStore';
const SEQUENCE_MODEL = 'Sequence';
const SCREENING_RESULT_MODEL = 'ScreeningResult';

interface BatchCreateResponse {
  results: any[];
  errors: any[];
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
}

@Injectable()
export class MPIService {
  constructor(
    private readonly jwtService: JwtService,
    @InjectModel(TOKEN_STORE_MODEL) private tokenStoreModel: Model<TokenStore>,
    @InjectModel('Sequence') private sequenceModel: Model<Sequence>,
    @InjectModel('ScreeningResult') private screeningResultModel: Model<ScreeningResult>
  ) {}

  // Default user ID for backward compatibility
  private defaultUserId = 'default_user';

  // Token refresh threshold (5 minutes)
  private readonly TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000;

  async getUserData(userId: string): Promise<any> {
    const userData = await this.tokenStoreModel.findOne({ userId });
    if (!userData?.userInfo) {
      throw new HttpException('User data not found', HttpStatus.NOT_FOUND);
    }
    return userData.userInfo;
  }

  async isLoggedIn(userId?: string): Promise<boolean> {
    const id = userId || this.defaultUserId;
    const userData = await this.tokenStoreModel.findOne({ userId: id });
    return Boolean(userData?.accessToken && userData.accessTokenExpiration > new Date());
  }

  async exchangeCodeForToken(code: string, state: string): Promise<{ token: string; userInfo: any }> {
    try {
      const tokenResponse = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
        grant_type: 'authorization_code',
        client_id: process.env.AUTH0_CLIENT_ID,
        client_secret: process.env.AUTH0_CLIENT_SECRET,
        code: code,
        redirect_uri: process.env.AUTH0_CALLBACK_URL,
        state: state
      });

      const { access_token } = tokenResponse.data;

      const userInfoResponse = await axios.get(`https://${process.env.AUTH0_DOMAIN}/userinfo`, {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      const userInfo = userInfoResponse.data;

      // Store in MongoDB instead of in-memory
      await this.tokenStoreModel.findOneAndUpdate(
        { userId: userInfo.sub },
        {
          accessToken: access_token,
          refreshToken: tokenResponse.data.refresh_token,
          accessTokenExpiration: new Date(Date.now() + tokenResponse.data.expires_in * 1000),
          userInfo: userInfo
        },
        { upsert: true }
      );

      const sessionToken = this.jwtService.sign({ userId: userInfo.sub }, { expiresIn: '24h' });

      return {
        token: sessionToken,
        userInfo: userInfo
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 400) {
          throw new HttpException('Invalid authorization code', HttpStatus.BAD_REQUEST);
        } else if (error.response?.status === 401) {
          throw new HttpException('Authentication failed', HttpStatus.UNAUTHORIZED);
        }
      }
      throw new HttpException('Failed to exchange code for token', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getAccessToken(userId?: string): Promise<string> {
    const id = userId || this.defaultUserId;
    const userData = await this.tokenStoreModel.findOne({ userId: id });

    if (!userData) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }

    // Check if token needs refresh (within 5 minutes of expiration)
    const fiveMinutesFromNow = new Date(Date.now() + this.TOKEN_REFRESH_THRESHOLD);
    if (userData.accessTokenExpiration < fiveMinutesFromNow) {
      try {
        await this.refreshToken(id);
        const refreshedData = await this.tokenStoreModel.findOne({ userId: id });
        if (!refreshedData) {
          throw new UnauthorizedException('Failed to refresh token');
        }
        return refreshedData.accessToken;
      } catch (error) {
        console.error('Token refresh failed:', error);
        throw new UnauthorizedException('Failed to refresh token');
      }
    }

    return userData.accessToken;
  }

  async refreshToken(userId: string): Promise<void> {
    const userData = await this.tokenStoreModel.findOne({ userId });
    if (!userData || !userData.refreshToken) {
      throw new UnauthorizedException('No refresh token found');
    }

    const tokenUrl = `https://${process.env.AUTH0_DOMAIN}/oauth/token`;
    const payload = {
      grant_type: 'refresh_token',
      client_id: process.env.AUTH0_CLIENT_ID,
      client_secret: process.env.AUTH0_CLIENT_SECRET,
      refresh_token: userData.refreshToken
    };

    try {
      const response = await axios.post(tokenUrl, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      const { access_token, refresh_token, expires_in } = response.data;
      const accessTokenExpiration = new Date(Date.now() + expires_in * 1000);

      // Update token in MongoDB
      await this.tokenStoreModel.findOneAndUpdate(
        { userId },
        {
          accessToken: access_token,
          refreshToken: refresh_token || userData.refreshToken,
          accessTokenExpiration
        }
      );
    } catch (error) {
      console.error('Token refresh error:', error.response?.data || error.message);
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        // If refresh token is invalid, clear the token store
        await this.tokenStoreModel.deleteOne({ userId });
      }
      throw new Error('Failed to refresh token');
    }
  }

  async logout(userId?: string): Promise<string> {
    const id = userId || this.defaultUserId;
    await this.tokenStoreModel.deleteOne({ userId: id });
    return 'Successfully logged out, you can close this tab now.';
  }

  async createSequence(input: CreateSequenceInput, userId?: string): Promise<Sequence> {
    // First create in MPI backend
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }

    try {
      const mpiResponse = await axios.post(`${process.env.MPI_BACKEND}/sequences`, input, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      // Then create in our database with the MPI ID
      const now = new Date();
      const sequence = new this.sequenceModel({
        ...input,
        type: input.type || 'unknown',
        annotations: input.annotations || [],
        userId: userId || 'system',
        mpiId: mpiResponse.data.id, // Store the MPI ID
        created_at: now,
        updated_at: now
      });
      const savedSequence = await sequence.save();
      return savedSequence.toJSON() as unknown as Sequence;
    } catch (error) {
      console.error('Failed to create sequence in MPI:', error);
      throw new HttpException('Failed to create sequence in MPI', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createSequences(sequences: Sequence[], userId?: string): Promise<BatchCreateResponse> {
    const results = [];
    const errors = [];

    for (const sequence of sequences) {
      try {
        const result = await this.createSequence(sequence, userId);
        results.push({
          success: true,
          sequence: result,
          name: sequence.name // Including name for easier identification
        });
      } catch (error) {
        errors.push({
          success: false,
          error: error.message,
          name: sequence.name,
          sequence: sequence
        });
        console.error(`Failed to create sequence ${sequence.name}:`, error);
      }
    }

    return {
      results,
      errors,
      summary: {
        total: sequences.length,
        successful: results.length,
        failed: errors.length
      }
    };
  }

  async getSequences(userId?: string): Promise<Sequence[]> {
    const query = userId ? { userId } : {};
    const sequences = await this.sequenceModel.find(query).exec();
    return sequences.map((seq) => seq.toJSON() as unknown as Sequence);
  }

  async getSequence(id: string, userId?: string): Promise<Sequence | null> {
    const query = userId ? { _id: id, userId } : { _id: id };
    const sequence = await this.sequenceModel.findOne(query).exec();
    if (!sequence) return null;
    return sequence;
  }

  async updateSequence(id: string, sequence: Partial<Sequence>, userId?: string): Promise<any> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const response = await axios.patch(`${process.env.MPI_BACKEND}/sequences/${id}`, sequence, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  }

  async deleteSequence(id: string, userId?: string): Promise<boolean> {
    const query = userId ? { _id: id, userId } : { _id: id };
    const result = await this.sequenceModel.findOneAndDelete(query).exec();
    return !!result;
  }

  async screenSequence(input: ScreeningInput, userId?: string): Promise<ScreeningResult> {
    // First get the sequence from our database
    const sequence = await this.getSequence(input.sequenceId, userId);
    if (!sequence) {
      throw new HttpException('Sequence not found', HttpStatus.NOT_FOUND);
    }

    // Get MPI token
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }

    try {
      // Call MPI backend for screening
      const mpiResponse = await axios.post(
        `${process.env.MPI_BACKEND}/secure-dna/screen`,
        {
          sequenceId: sequence.mpiId, // Use the MPI ID
          region: input.region
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Format threats to match our schema
      const formattedThreats = (mpiResponse.data.threats || []).map((threat: any) => ({
        name: threat.most_likely_organism?.name || 'Unknown Organism',
        hit_regions:
          threat.hit_regions?.map((region: any) => ({
            seq: region.seq,
            seq_range_start: region.seq_range_start,
            seq_range_end: region.seq_range_end
          })) || [],
        is_wild_type: threat.is_wild_type || false,
        references: threat.organisms?.map((org: any) => org.name) || []
      }));

      // Create screening result with MPI response
      const result = new this.screeningResultModel({
        sequence: sequence._id,
        region: input.region,
        status: mpiResponse.data.status,
        threats: formattedThreats,
        userId: userId || sequence.userId
      });
      const savedResult = await result.save();

      // Populate the sequence field before returning
      const populatedResult = await this.screeningResultModel.findById(savedResult._id).populate('sequence').exec();

      if (!populatedResult) {
        throw new HttpException('Failed to retrieve populated screening result', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      return populatedResult.toJSON() as unknown as ScreeningResult;
    } catch (error) {
      console.error('Error in screenSequence:', error);
      throw new HttpException('Failed to screen sequence in MPI', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getScreeningResults(sequenceId: string, userId?: string): Promise<ScreeningResult[]> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const response = await axios.get(`${process.env.MPI_BACKEND}/secure-dna/screen/${sequenceId}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  }

  async getUserScreenings(userId?: string): Promise<ScreeningResult[]> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }

    // Get screenings from our local MongoDB
    const localScreenings = await this.screeningResultModel.find({ userId }).populate('sequence').exec();
    return localScreenings.map((screening) => screening.toJSON() as unknown as ScreeningResult);
  }

  async screenSequencesBatch(input: { sequenceIds: string[]; region: Region }, userId?: string): Promise<ScreeningResult[]> {
    const results: ScreeningResult[] = [];

    // First verify all sequences exist
    const sequences = await Promise.all(input.sequenceIds.map((id) => this.getSequence(id, userId)));

    // Check if any sequences were not found
    const missingSequences = sequences.filter((seq) => !seq);
    if (missingSequences.length > 0) {
      throw new HttpException('One or more sequences not found', HttpStatus.NOT_FOUND);
    }

    // Start screening process for all sequences
    for (const sequence of sequences) {
      if (!sequence) continue; // Skip if sequence not found

      try {
        const result = await this.screenSequence(
          {
            sequenceId: sequence._id!.toString(),
            region: input.region
          },
          userId
        );
        results.push(result);
      } catch (error) {
        console.error(`Failed to screen sequence ${sequence._id}:`, error);
      }
    }

    return results;
  }
}
