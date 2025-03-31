import { Controller, Post, Body, Get, Param, UseGuards, Req } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { ScreeningInput, ScreeningResult, Region } from './types';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    name?: string;
    email?: string;
  };
}

interface BatchScreeningRequest {
  sequenceIds: string[];
  region: Region;
}

@Controller('secure-dna')
export class SecureDNAController {
  constructor(private readonly mpiService: MPIService) {}

  @Post('screen')
  @UseGuards(AuthGuard)
  async screenSequence(@Body() screeningRequest: ScreeningInput, @Req() req: AuthenticatedRequest): Promise<ScreeningResult> {
    const userId = req.user.userId;
    return this.mpiService.screenSequence(screeningRequest, userId);
  }

  @Post('screen/batch')
  @UseGuards(AuthGuard)
  async screenSequencesBatch(@Body() request: BatchScreeningRequest, @Req() req: AuthenticatedRequest): Promise<{ message: string; status: string; timestamp: string }> {
    const userId = req.user.userId;

    // Start the processing in the background
    this.mpiService
      .screenSequencesBatch(
        {
          sequenceIds: request.sequenceIds,
          region: request.region
        },
        userId
      )
      .catch((error) => {
        console.error('Batch screening failed:', error);
      });

    // Return immediately with acknowledgment
    return {
      message: `Processing ${request.sequenceIds.length} sequences`,
      status: 'PROCESSING',
      timestamp: new Date().toISOString()
    };
  }

  @Get('screen/:sequenceId')
  @UseGuards(AuthGuard)
  async getScreeningResults(@Param('sequenceId') sequenceId: string, @Req() req: AuthenticatedRequest): Promise<ScreeningResult[]> {
    const userId = req.user.userId;
    return this.mpiService.getScreeningResults(sequenceId, userId);
  }

  @Get('screenings')
  @UseGuards(AuthGuard)
  async getUserScreenings(@Req() req: AuthenticatedRequest): Promise<ScreeningResult[]> {
    const userId = req.user.userId;
    return this.mpiService.getUserScreenings(userId);
  }
}
