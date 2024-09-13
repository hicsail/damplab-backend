import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';

// type ELabsStudyResponse = {
//   studyID      : number;
//   projectID    : number;
//   groupID      : number;
//   subGroupID   : number;
//   userID       : number;
//   name         : string;
//   statusChanged: string;
//   description  : string;
//   notes        : string;
//   approve      : string;
//   created      : string;
//   deleted      : boolean;
// };

type eLabsStatus = 'PENDING' | 'PROGRESS' | 'COMPLETED';

// type ELabsExperimentResponse = {
//   bearerToken     : string,
//   experimentID    : number,
//   studyID         : number,
//   name            : string,
//   status          : eLabsStatus,
//   templateID?     : number,
//   autoCollaborate?: boolean
// }

@Injectable()
export class MPIService {
  private tokenStore = new Map<string, { accessToken: string; refreshToken: string; accessTokenExpiration: Date }>();

  // TODO: put this in an env file.
  private client_id = 'tZSXM9f8WUiPIpNGt1kXlGqzZVYvWNEF'; // Auth0 Damp Canvas app client ID
  private client_secret = 'uHw3eZ4XrYcBW1zJJqWt1dbLC6YuwCT-v0AeXa1npLuhiEkw-Ayq1wwDcw3FSgnh'; // Auth0 Damp Canvas app client secret

  // TODO: this should be the actual user id, got from DAMP LAB auth?
  private currentUserId = 'mpitest';

  // To log in use:
  // NOTE THAT THIS SERVER IS RUNNING ON PORT 5100
  // https://mpi-dev.us.auth0.com/authorize?response_type=code&scope=offline_access&client_id=tZSXM9f8WUiPIpNGt1kXlGqzZVYvWNEF&redirect_uri=http://127.0.0.1:5100/mpi/auth0_redirect&audience=https://mpi.com
  // To log out use:
  // https://mpi-dev.us.auth0.com/oidc/logout?post_logout_redirect_uri=http://127.0.0.1:5100/mpi/auth0_logout&client_id=tZSXM9f8WUiPIpNGt1kXlGqzZVYvWNEF

  async exchangeCodeForToken(code: string): Promise<string> {
    const tokenUrl = `https://mpi-dev.us.auth0.com/oauth/token`;
    const payload = {
      grant_type: 'authorization_code',
      client_id: this.client_id,
      client_secret: this.client_secret,
      code,
      redirect_uri: 'http://127.0.0.1:5100/mpi/auth0_redirect' // URL in this server that was used to redirect to after Auth0 login
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

    const tokenUrl = `https://mpi-dev.us.auth0.com/oauth/token`;
    const payload = {
      grant_type: 'refresh_token',
      client_id: this.client_id,
      client_secret: this.client_secret,
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
      return new BadRequestException('No token found, log in to MPI first');
    }
    const sequences = await axios.get('http://localhost:5000/sequences', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return sequences.data;
  }

  async getSequences(): Promise<any> {
    const token = await this.getAccessToken();
    if (!token) {
      return new BadRequestException('No token found, log in to MPI first');
    }
    const sequences = await axios.get('http://localhost:5000/sequences', {
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
      return new BadRequestException('No token found, log in to MPI first');
    }
    const azentaSeqOrder = await axios.get(`http://localhost:5000/azenta/seqOrder/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return azentaSeqOrder.data;
  }

  async azentaSeqOrders(): Promise<any> {
    const token = await this.getAccessToken();
    if (!token) {
      return new BadRequestException('No token found, log in to MPI first');
    }
    const azentaSeqOrders = await axios.get('http://localhost:5000/azenta/seqOrder', {
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
      throw new BadRequestException('No token found, log in to MPI first');
    }
    const azentaSeqOrders = await axios.post('http://localhost:5000/azenta/seqOrder', order, {
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
      throw new BadRequestException('No token found, log in to MPI first');
    }
    try {
      const response = await axios.post(
        'http://localhost:5000/e-labs/create-study',
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
      throw new BadRequestException('No token found, log in to MPI first');
    }
    try {
      const response = await axios.post(
        'http://localhost:5000/e-labs/create-experiment',
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
}
