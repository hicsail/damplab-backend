import { Controller, Get, Query, Post, Patch, Body, Param } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Sequence, AclidSequence, eLabsStatus } from './types';

@Controller('mpi')
export class MPIController {
  constructor(private readonly mpiService: MPIService) {}

  @Get('auth0_redirect')
  async callback(@Query('code') code: string): Promise<string> {
    return await this.mpiService.exchangeCodeForToken(code);
  }

  @Get('is_logged_in')
  isLoggedIn(): { loggedIn: boolean } {
    return { loggedIn: this.mpiService.isLoggedIn() };
  }

  @Get('auth0_logout')
  async logout(): Promise<string> {
    return this.mpiService.logout();
  }

  @Get('sequences')
  async getSequences(): Promise<string> {
    return this.mpiService.getSequences();
  }

  @Post('sequences')
  async createSequence(@Body() sequence: Sequence): Promise<string> {
    return this.mpiService.createSequence(sequence);
  }

  @Post('sequences/batch')
  async createSequences(@Body() sequences: Sequence[]): Promise<any> {
    // Start the processing in the background
    this.mpiService.createSequences(sequences).catch((error) => console.error('Batch sequence creation failed:', error));

    // Return immediately with acknowledgment
    return {
      message: `Processing ${sequences.length} sequences`,
      status: 'PROCESSING',
      timestamp: new Date().toISOString()
    };
  }

  @Get('azentaSeqOrder/:id')
  async azentaSeqOrder(id: string): Promise<string> {
    return this.mpiService.azentaSeqOrder(id);
  }

  @Get('azentaSeqOrders')
  async azentaSeqOrders(): Promise<string> {
    return this.mpiService.azentaSeqOrders();
  }

  @Get('azentaCreateSeqOrder')
  async azentaCreateSeqOrder(): Promise<string> {
    return this.mpiService.azentaCreateSeqOrder();
  }

  @Post('e-labs/create-study')
  async createELabsStudy(@Body('bearerToken') bearerToken: string, @Body('projectID') projectID: number, @Body('name') name: string): Promise<number | undefined> {
    return this.mpiService.createELabsStudy(bearerToken, projectID, name);
  }

  @Post('e-labs/create-experiment')
  async createELabsExperiment(
    @Body('bearerToken') bearerToken: string,
    @Body('studyID') studyID: number,
    @Body('name') name: string,
    @Body('status') status: eLabsStatus,
    @Body('templateID') templateID?: number,
    @Body('autoCollaborate') autoCollaborate?: boolean
  ): Promise<number | undefined> {
    return this.mpiService.createELabsExperiment(bearerToken, studyID, name, status, templateID, autoCollaborate);
  }

  @Get('securedna/screens')
  async getGenomes(): Promise<object> {
    return this.mpiService.getGenomes();
  }

  @Patch('securedna/screen/:id')
  async updateGenome(@Param('id') id: string, @Body('adminStatus') adminStatus: string): Promise<object> {
    return this.mpiService.updateGenome(id, adminStatus);
  }

  @Patch('securedna/run-screening')
  async runBiosecurityCheck(@Body('ids') ids: string[]): Promise<object> {
    return this.mpiService.runBiosecurityCheck(ids);
  }

  @Patch('securedna/run-screening/batch')
  async runBiosecurityChecks(@Body('ids') ids: string[]): Promise<any> {
    // Start the processing in the background
    this.mpiService.runBiosecurityChecks(ids).catch((error) => console.error('Batch biosecurity check failed:', error));

    // Return immediately with acknowledgment
    return {
      message: `Processing ${ids.length} biosecurity checks`,
      status: 'PROCESSING',
      timestamp: new Date().toISOString()
    };
  }

  @Get('aclid/screens')
  async getAclidScreenings(): Promise<JSON> {
    return this.mpiService.getAclidScreenings();
  }

  @Get('aclid/screen/:id')
  async getAclidScreening(id: string): Promise<JSON> {
    return this.mpiService.getAclidScreening(id);
  }

  @Post('aclid/run-screening')
  async createAclidScreening(@Body('submissionName') submissionName: string, @Body('sequences') sequences: AclidSequence[]): Promise<JSON> {
    return this.mpiService.runAclidScreening(submissionName, sequences);
  }
}
