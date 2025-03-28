import { Injectable, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { Sequence, ScreeningInput, ScreeningResult, Region } from './types';
import { JwtService } from '@nestjs/jwt';

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
  constructor(private readonly jwtService: JwtService) {}

  private tokenStore = new Map<
    string,
    {
      accessToken: string;
      refreshToken: string;
      accessTokenExpiration: Date;
      userInfo?: any; // Store user profile info
    }
  >();

  // Default user ID for backward compatibility
  private defaultUserId = 'default_user';

  async getUserData(userId: string): Promise<any> {
    const userData = this.tokenStore.get(userId);
    if (!userData?.userInfo) {
      throw new HttpException('User data not found', HttpStatus.NOT_FOUND);
    }
    return userData.userInfo;
  }

  async isLoggedIn(userId?: string): Promise<boolean> {
    const id = userId || this.defaultUserId;
    const userData = this.tokenStore.get(id);
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

      this.tokenStore.set(userInfo.sub, {
        accessToken: access_token,
        refreshToken: tokenResponse.data.refresh_token,
        accessTokenExpiration: new Date(Date.now() + tokenResponse.data.expires_in * 1000),
        userInfo: userInfo
      });

      const sessionToken = this.jwtService.sign({ userId: userInfo.sub }, { expiresIn: '24h' });

      return {
        token: sessionToken,
        userInfo: userInfo
      };
    } catch (error) {
      throw new HttpException('Failed to exchange code for token', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getAccessToken(userId?: string): Promise<string> {
    const id = userId || this.defaultUserId;
    const userData = this.tokenStore.get(id);

    if (!userData) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }

    if (userData.accessTokenExpiration > new Date()) {
      return userData.accessToken;
    } else {
      try {
        await this.refreshToken(id);
        const refreshedData = this.tokenStore.get(id);

        if (!refreshedData) {
          throw new UnauthorizedException('Failed to refresh token');
        }

        return refreshedData.accessToken;
      } catch (error) {
        throw new UnauthorizedException('Failed to refresh token');
      }
    }
  }

  async refreshToken(userId: string): Promise<void> {
    const userData = this.tokenStore.get(userId);
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

      // Update token in store
      this.tokenStore.set(userId, {
        ...userData,
        accessToken: access_token,
        refreshToken: refresh_token || userData.refreshToken,
        accessTokenExpiration
      });
    } catch (error) {
      console.error('Token refresh error:', error.response?.data || error.message);
      throw new Error('Failed to refresh token');
    }
  }

  async logout(userId?: string): Promise<string> {
    const id = userId || this.defaultUserId;
    this.tokenStore.delete(id);
    return 'Successfully logged out, you can close this tab now.';
  }

  async createSequence(sequence: Sequence, userId?: string): Promise<any> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const response = await axios.post(`${process.env.MPI_BACKEND}/sequences`, sequence, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
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

  async getSequences(userId?: string): Promise<any> {
    console.log('getSequences', userId);
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const sequences = await axios.get(`${process.env.MPI_BACKEND}/sequences`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return sequences.data;
  }

  async getSequence(id: string, userId?: string): Promise<any> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const sequence = await axios.get(`${process.env.MPI_BACKEND}/sequences/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return sequence.data;
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

  async deleteSequence(id: string, userId?: string): Promise<any> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const response = await axios.delete(`${process.env.MPI_BACKEND}/sequences/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  }

  async screenSequence(screeningRequest: ScreeningInput, userId?: string): Promise<ScreeningResult> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const response = await axios.post(`${process.env.MPI_BACKEND}/secure-dna/screen`, screeningRequest, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
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
    const response = await axios.get(`${process.env.MPI_BACKEND}/secure-dna/screenings`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  }

  async screenSequencesBatch(sequenceIds: string[], region: string, userId?: string): Promise<void> {
    const results = [];
    const errors = [];

    for (const sequenceId of sequenceIds) {
      try {
        const result = await this.screenSequence(
          {
            sequenceId,
            region: region as Region
          },
          userId
        );
        results.push({
          success: true,
          sequenceId,
          result
        });
      } catch (error) {
        errors.push({
          success: false,
          sequenceId,
          error: error.message
        });
        console.error(`Failed to screen sequence ${sequenceId}:`, error);
      }
    }

    // Log the final results
    console.log('Batch screening completed:', {
      total: sequenceIds.length,
      successful: results.length,
      failed: errors.length,
      results,
      errors
    });
  }
}
