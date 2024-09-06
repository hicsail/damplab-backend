import { Controller, Get, Query } from '@nestjs/common';
import { MPIService } from './mpi.service';

@Controller('mpi')
export class MPIController {
  constructor(private readonly mpiService: MPIService) {}

  @Get('auth0_redirect')
  async callback(@Query('code') code: string): Promise<string> {
    return await this.mpiService.exchangeCodeForToken(code);
  }

  @Get('sequences')
  async getSequences(): Promise<string> {
    return this.mpiService.getSequences();
  }

  @Get('auth0_logout')
  async logout(): Promise<string> {
    return this.mpiService.logout();
  }
}
