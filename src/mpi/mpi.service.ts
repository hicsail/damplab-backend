import { Injectable, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { Sequence, AclidSequence, BiosecurityResponse, ScreenSequencesDTO, eLabsStatus } from './types';
import * as jwt from 'jsonwebtoken';

interface BatchCreateResponse {
  results: any[];
  errors: any[];
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
}

interface BiosecurityBatchResponse {
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
    if (!userData) {
      throw new UnauthorizedException('User not found');
    }
    return userData.userInfo || {};
  }

  async isLoggedIn(userId?: string): Promise<boolean> {
    const id = userId || this.defaultUserId;
    const userData = this.tokenStore.get(id);
    if (userData && userData.accessToken && userData.accessTokenExpiration) {
      return userData.accessTokenExpiration > new Date();
    }
    return false;
  }

  async exchangeCodeForToken(code: string, state?: string): Promise<{ token: string; userInfo: any }> {
    const tokenUrl = `https://${process.env.AUTH0_DOMAIN}/oauth/token`;
    const payload = {
      grant_type: 'authorization_code',
      client_id: process.env.AUTH0_CLIENT_ID,
      client_secret: process.env.AUTH0_CLIENT_SECRET,
      code,
      redirect_uri: process.env.AUTH0_CALLBACK_URL
    };

    try {
      // Exchange code for tokens
      const tokenResponse = await axios.post(tokenUrl, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      const { access_token, refresh_token, expires_in, id_token } = tokenResponse.data;
      const accessTokenExpiration = new Date(Date.now() + expires_in * 1000);

      // Get user info
      const userInfoResponse = await axios.get(`https://${process.env.AUTH0_DOMAIN}/userinfo`, {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      const userInfo = userInfoResponse.data;
      const userId = userInfo.sub || this.defaultUserId; // Auth0 user ID

      // Store tokens with user ID
      this.tokenStore.set(userId, {
        accessToken: access_token,
        refreshToken: refresh_token,
        accessTokenExpiration,
        userInfo
      });

      // Create a session token for the frontend
      const jwtSecret = process.env.JWT_SECRET || 'default_jwt_secret';
      const sessionToken = jwt.sign(
        {
          userId,
          name: userInfo.name,
          email: userInfo.email
        },
        jwtSecret,
        { expiresIn: '1d' }
      );

      return {
        token: sessionToken,
        userInfo: {
          name: userInfo.name,
          email: userInfo.email,
          picture: userInfo.picture
        }
      };
    } catch (error) {
      console.error('Token exchange error:', error.response?.data || error.message);
      throw new Error('Failed to exchange code for token');
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
      return new UnauthorizedException('No token found, log in to MPI first');
    }
    const response = await axios.post(`${process.env.MPI_BACKEND}/sequences`, sequence, {
      headers: {
        Authorization: `Bearer ${token}`
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
    const token = await this.getAccessToken(userId);
    if (!token) {
      return new UnauthorizedException('No token found, log in to MPI first');
    }
    const sequences = await axios.get(`${process.env.MPI_BACKEND}/sequences`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return sequences.data;
  }

  // Azenta endpoints
  async azentaSeqOrder(id: string, userId?: string): Promise<any> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      return new UnauthorizedException('No token found, log in to MPI first');
    }
    const azentaSeqOrder = await axios.get(`${process.env.MPI_BACKEND}/azenta/seqOrder/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return azentaSeqOrder.data;
  }

  async azentaSeqOrders(userId?: string): Promise<any> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      return new UnauthorizedException('No token found, log in to MPI first');
    }
    const azentaSeqOrders = await axios.get(`${process.env.MPI_BACKEND}/azenta/seqOrder`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return azentaSeqOrders.data;
  }

  async azentaCreateSeqOrder(userId?: string): Promise<any> {
    const token = await this.getAccessToken(userId);
    const order = {
      orderName: 'DAMP_Azenta_Order'
    };
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const azentaSeqOrders = await axios.post(`${process.env.MPI_BACKEND}/azenta/seqOrder`, order, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    return azentaSeqOrders.data;
  }

  // eLabs
  async createELabsStudy(bearerToken: string, projectID: number, name: string, userId?: string): Promise<number | undefined> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    try {
      const response = await axios.post(
        `${process.env.MPI_BACKEND}/e-labs/create-study`,
        { bearerToken, projectID, name },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
          }
        }
      );

      if (!response.data || !response.data.studyID) {
        throw new Error('Error creating eLabs Study from Canvas Workflow...');
      }

      return response.data.studyID;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  async createELabsExperiment(bearerToken: string, studyID: number, name: string, status: eLabsStatus, templateID?: number, autoCollaborate?: boolean, userId?: string): Promise<number | undefined> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    try {
      const response = await axios.post(
        `${process.env.MPI_BACKEND}/e-labs/create-experiment`,
        { bearerToken, studyID, name, status, templateID, autoCollaborate },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
          }
        }
      );

      if (!response.data || !response.data.experimentID) {
        throw new Error('Error creating eLabs Experiment from Canvas Service...');
      }

      return response.data.experimentID;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  // securedna
  async getGenomes(userId?: string): Promise<object> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const response = await axios.get(`${process.env.MPI_BACKEND}/biosecurity/genomes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  }

  async updateGenome(id: string, adminStatus: string, userId?: string): Promise<object> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const response = await axios.patch(
      `${process.env.MPI_BACKEND}/biosecurity/genomes/${id}`,
      { adminStatus },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    return response.data;
  }

  async runBiosecurityCheck(seq_ids: string[], userId?: string): Promise<BiosecurityResponse> {
    const token = await this.getAccessToken(userId);
    console.log('Initiated security check', seq_ids);
    if (!token) {
      throw new UnauthorizedException('No token found, log in to MPI first');
    }
    const response = await axios.patch(
      `${process.env.MPI_BACKEND}/biosecurity`,
      { ids: seq_ids },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    console.log('Biosecurity check response:', response.data);
    return response.data;
  }

  async runBiosecurityChecks(seq_ids: string[], userId?: string): Promise<BiosecurityBatchResponse> {
    const results = [];
    const errors = [];

    for (const id of seq_ids) {
      try {
        const result = await this.runBiosecurityCheck([id], userId);
        results.push({
          success: true,
          sequence_id: id,
          result
        });
      } catch (error) {
        errors.push({
          success: false,
          sequence_id: id,
          error: error.message
        });
        console.error(`Failed to run biosecurity check for sequence ${id}:`, error);
      }
    }

    return {
      results,
      errors,
      summary: {
        total: seq_ids.length,
        successful: results.length,
        failed: errors.length
      }
    };
  }

  // aclid
  async getAclidScreenings(userId?: string): Promise<any> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      return new UnauthorizedException('No token found, log in to MPI first');
    }
    const aclid = await axios.get(`${process.env.MPI_BACKEND}/aclid/screens`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return aclid.data;
  }

  async getAclidScreening(id: string, userId?: string): Promise<any> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      return new UnauthorizedException('No token found, log in to MPI first');
    }
    const aclid = await axios.get(`${process.env.MPI_BACKEND}/aclid/screens/${id}/details`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return aclid.data;
  }

  async runAclidScreening(submissionName: string, sequences: AclidSequence[], userId?: string): Promise<any> {
    // sequences: [{name: string, sequence: string}]
    const token = await this.getAccessToken(userId);
    if (!token) {
      return new UnauthorizedException('No token found, log in to MPI first');
    }

    const requestBody: ScreenSequencesDTO = {
      submissionName,
      sequences
    };
    console.log('runAclidScreening request:', requestBody);

    try {
      const aclid = await axios.post(`${process.env.MPI_BACKEND}/aclid/screen`, requestBody, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('aclid data', aclid.data);
      return aclid.data;
    } catch (error) {
      if (error.response) {
        console.error('Error response:', error.response.data);
        throw new Error(`ACLID screening failed: ${error.response.data.message || 'Unknown error'}`);
      }
      throw error;
    }
  }
}
