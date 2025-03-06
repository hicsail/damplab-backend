import { Controller, Get, Query, Post, Patch, Body, Param, UseGuards, Req, HttpStatus, HttpException } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Sequence, AclidSequence, eLabsStatus } from './types';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    name?: string;
    email?: string;
  };
}

@Controller('mpi')
export class MPIController {
  constructor(private readonly mpiService: MPIService) {}

  @Get('auth0_redirect')
  async callback(@Query('code') code: string, @Query('state') state: string): Promise<{ token: string; userInfo: any }> {
    try {
      return await this.mpiService.exchangeCodeForToken(code, state);
    } catch (error) {
      throw new HttpException(`Authentication failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('user-info')
  @UseGuards(AuthGuard)
  async getUserInfo(@Req() req: AuthenticatedRequest): Promise<any> {
    try {
      const userId = req.user.userId;
      return await this.mpiService.getUserData(userId);
    } catch (error) {
      throw new HttpException(`Failed to get user data: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('is_logged_in')
  async isLoggedIn(): Promise<{ loggedIn: boolean }> {
    return { loggedIn: await this.mpiService.isLoggedIn() };
  }

  @Get('auth0_logout')
  async logout(): Promise<string> {
    return this.mpiService.logout();
  }

  @Get('sequences')
  @UseGuards(AuthGuard)
  async getSequences(@Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.getSequences(userId);
  }

  @Post('sequences')
  @UseGuards(AuthGuard)
  async createSequence(@Body() sequence: Sequence, @Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.createSequence(sequence, userId);
  }

  @Post('sequences/batch')
  @UseGuards(AuthGuard)
  async createSequences(@Body() sequences: Sequence[], @Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;

    // Start the processing in the background
    this.mpiService.createSequences(sequences, userId).catch((error) => console.error('Batch sequence creation failed:', error));

    // Return immediately with acknowledgment
    return {
      message: `Processing ${sequences.length} sequences`,
      status: 'PROCESSING',
      timestamp: new Date().toISOString()
    };
  }

  @Get('azentaSeqOrder/:id')
  @UseGuards(AuthGuard)
  async azentaSeqOrder(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.azentaSeqOrder(id, userId);
  }

  @Get('azentaSeqOrders')
  @UseGuards(AuthGuard)
  async azentaSeqOrders(@Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.azentaSeqOrders(userId);
  }

  @Get('azentaCreateSeqOrder')
  @UseGuards(AuthGuard)
  async azentaCreateSeqOrder(@Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.azentaCreateSeqOrder(userId);
  }

  @Post('e-labs/create-study')
  @UseGuards(AuthGuard)
  async createELabsStudy(@Body('bearerToken') bearerToken: string, @Body('projectID') projectID: number, @Body('name') name: string, @Req() req: AuthenticatedRequest): Promise<number | undefined> {
    const userId = req.user.userId;
    return this.mpiService.createELabsStudy(bearerToken, projectID, name, userId);
  }

  @Post('e-labs/create-experiment')
  @UseGuards(AuthGuard)
  async createELabsExperiment(
    @Body('bearerToken') bearerToken: string,
    @Body('studyID') studyID: number,
    @Body('name') name: string,
    @Body('status') status: eLabsStatus,
    @Body('templateID') templateID?: number,
    @Body('autoCollaborate') autoCollaborate?: boolean,
    @Req() req?: AuthenticatedRequest
  ): Promise<number | undefined> {
    const userId = req?.user?.userId;
    return this.mpiService.createELabsExperiment(bearerToken, studyID, name, status, templateID, autoCollaborate, userId);
  }

  @Get('securedna/screens')
  @UseGuards(AuthGuard)
  async getGenomes(@Req() req: AuthenticatedRequest): Promise<object> {
    const userId = req.user.userId;
    return this.mpiService.getGenomes(userId);
  }

  @Patch('securedna/screen/:id')
  @UseGuards(AuthGuard)
  async updateGenome(@Param('id') id: string, @Body('adminStatus') adminStatus: string, @Req() req: AuthenticatedRequest): Promise<object> {
    const userId = req.user.userId;
    return this.mpiService.updateGenome(id, adminStatus, userId);
  }

  @Patch('securedna/run-screening')
  @UseGuards(AuthGuard)
  async runBiosecurityCheck(@Body('ids') ids: string[], @Req() req: AuthenticatedRequest): Promise<object> {
    const userId = req.user.userId;
    return this.mpiService.runBiosecurityCheck(ids, userId);
  }

  @Patch('securedna/run-screening/batch')
  @UseGuards(AuthGuard)
  async runBiosecurityChecks(@Body('ids') ids: string[], @Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;

    // Start the processing in the background
    this.mpiService.runBiosecurityChecks(ids, userId).catch((error) => console.error('Batch biosecurity check failed:', error));

    // Return immediately with acknowledgment
    return {
      message: `Processing ${ids.length} biosecurity checks`,
      status: 'PROCESSING',
      timestamp: new Date().toISOString()
    };
  }

  @Get('aclid/screens')
  @UseGuards(AuthGuard)
  async getAclidScreenings(@Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.getAclidScreenings(userId);
  }

  @Get('aclid/screen/:id')
  @UseGuards(AuthGuard)
  async getAclidScreening(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.getAclidScreening(id, userId);
  }

  @Post('aclid/run-screening')
  @UseGuards(AuthGuard)
  async createAclidScreening(@Body('submissionName') submissionName: string, @Body('sequences') sequences: AclidSequence[], @Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.runAclidScreening(submissionName, sequences, userId);
  }
}
