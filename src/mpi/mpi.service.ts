import { Injectable, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';

type eLabsStatus = 'PENDING' | 'PROGRESS' | 'COMPLETED';

@Injectable()
export class MPIService {
  private tokenStore = new Map<string, { accessToken: string; refreshToken: string; accessTokenExpiration: Date }>();

  // TODO: this should be the actual user id, got from DAMP LAB auth?
  private currentUserId = 'mpitest';

  // To log in use (update uri as needed):
  // https://mpi-demo.us.auth0.com/authorize?response_type=code&scope=offline_access&client_id=<MPI_CLIENT_ID>&redirect_uri=http://127.0.0.1:5100/mpi/auth0_redirect&audience=https://mpi-demo.com
  // To log out use:
  // https://mpi-demo.us.auth0.com/oidc/logout?post_logout_redirect_uri=http://127.0.0.1:5100/mpi/auth0_logout&client_id=<MPI_CLIENT_ID>

  async exchangeCodeForToken(code: string): Promise<string> {
    const tokenUrl = process.env.MPI_TOKEN_URL || '';
    const payload = {
      grant_type: 'authorization_code',
      client_id: process.env.MPI_CLIENT_ID,
      client_secret: process.env.MPI_CLIENT_SECRET,
      code,
      redirect_uri: process.env.MPI_REDIRECT_URL // URL in this server that was used to redirect to after Auth0 login
    };

    const response = await axios.post(tokenUrl, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.status !== 200) {
      throw new Error('Failed to exchange authorization code for token');
    }

    const tokens = response.data;
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in;
    const accessTokenExpiration = new Date(Date.now() + expiresIn * 1000);

    // TODO: we should store this some other way that persists.
    this.tokenStore.set(this.currentUserId, { accessToken, refreshToken, accessTokenExpiration });

    return 'Successfully logged in, you can close this tab now.';
  }

  async exchangeRefreshTokenForToken(): Promise<void> {
    const refreshToken = this.tokenStore.get(this.currentUserId)!.refreshToken;

    const tokenUrl = process.env.MPI_TOKEN_URL || '';
    const payload = {
      grant_type: 'refresh_token',
      client_id: process.env.MPI_CLIENT_ID,
      client_secret: process.env.MPI_CLIENT_SECRET,
      refresh_token: refreshToken
    };

    const response = await axios.post(tokenUrl, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.status !== 200) {
      throw new Error('Failed to exchange authorization code for token');
    }

    const tokens = response.data;
    const accessToken = tokens.access_token;
    const expiresIn = tokens.expires_in;
    const accessTokenExpiration = new Date(Date.now() + expiresIn * 1000);

    // TODO: we should store this some other way that persists.
    this.tokenStore.set(this.currentUserId, { accessToken, refreshToken, accessTokenExpiration });
  }

  async logout(): Promise<string> {
    this.tokenStore.delete(this.currentUserId);
    return 'Successfully logged out, you can close this tab now.';
  }

  async getAccessToken(): Promise<string> {
    const user = this.tokenStore.get(this.currentUserId);
    if (user && user.accessToken && user.accessTokenExpiration) {
      if (user.accessTokenExpiration > new Date(Date.now())) {
        console.log('user ', user, ' has valid token');
        return user.accessToken;
      } else {
        console.log('user ', user, ' has expired token; requesting refreshed token');
        await this.exchangeRefreshTokenForToken();
        return this.tokenStore.get(this.currentUserId)!.accessToken;
      }
    }
    return '';
  }

  isLoggedIn(): boolean {
    const user = this.tokenStore.get(this.currentUserId);
    if (user && user.accessToken && user.accessTokenExpiration) {
      console.log('user ', user, ' is already logged in');
      return user.accessTokenExpiration > new Date();
    }
    return false;
  }

  async createSequence(): Promise<any> {
    const token = await this.getAccessToken();
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

  async getSequences(): Promise<any> {
    const token = await this.getAccessToken();
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
  async azentaSeqOrder(id: string): Promise<any> {
    const token = await this.getAccessToken();
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

  async azentaSeqOrders(): Promise<any> {
    const token = await this.getAccessToken();
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

  async azentaCreateSeqOrder(): Promise<any> {
    const token = await this.getAccessToken();
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
  async createELabsStudy(bearerToken: string, projectID: number, name: string): Promise<number | undefined> {
    const token = await this.getAccessToken();
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

  async createELabsExperiment(bearerToken: string, studyID: number, name: string, status: eLabsStatus, templateID?: number, autoCollaborate?: boolean): Promise<number | undefined> {
    const token = await this.getAccessToken();
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

  // aclid
  async getAclidScreenings(): Promise<any> {
    const token = await this.getAccessToken();
    if (!token) {
      return new UnauthorizedException('No token found, log in to MPI first');
    }
    const aclid = await axios.get(`${process.env.MPI_BACKEND}aclid/screens`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return aclid.data;
  }

  async getAclidScreening(id: string): Promise<any> {
    const token = await this.getAccessToken();
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

  async runAclidScreening(submissionName: string, sequences: JSON): Promise<any> {
    // sequences: [{name: string, sequence: string}]
    const token = await this.getAccessToken();
    if (!token) {
      return new UnauthorizedException('No token found, log in to MPI first');
    }
    const aclid = await axios.post(
      `${process.env.MPI_BACKEND}/aclid/screen`,
      { submissionName, sequences },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return aclid.data;
  }
}
