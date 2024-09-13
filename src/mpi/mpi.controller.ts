import { Controller, Get, Query, Post, Body } from '@nestjs/common';
import { MPIService } from './mpi.service';

type eLabsStatus = 'PENDING' | 'PROGRESS' | 'COMPLETED';

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
}
