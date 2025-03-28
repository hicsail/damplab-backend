import { Controller, Get, Query, Post, Patch, Body, Param, UseGuards, Req, HttpStatus, HttpException, Res, UnauthorizedException, Delete } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Sequence } from './types';
import { AuthGuard } from '../auth/auth.guard';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';

interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    name?: string;
    email?: string;
  };
}

@Controller('mpi')
export class MPIController {
  constructor(private readonly mpiService: MPIService, private readonly jwtService: JwtService) {}

  @Get('login')
  async login(@Query('state') state: string, @Query('redirectTo') redirectTo: string, @Res() res: Response): Promise<void> {
    if (!state || state === 'undefined') {
      throw new HttpException('Invalid state parameter', HttpStatus.BAD_REQUEST);
    }

    // Combine state and redirectTo into a single state parameter
    const combinedState = JSON.stringify({ state, redirectTo: redirectTo || '/' });

    const authUrl =
      `https://${process.env.AUTH0_DOMAIN}/authorize` +
      `?response_type=code` +
      `&scope=${encodeURIComponent('openid profile email offline_access')}` +
      `&client_id=${encodeURIComponent(process.env.AUTH0_CLIENT_ID || '')}` +
      `&redirect_uri=${encodeURIComponent(process.env.AUTH0_CALLBACK_URL || '')}` +
      `&audience=${encodeURIComponent(process.env.AUTH0_AUDIENCE || '')}` +
      `&state=${encodeURIComponent(combinedState)}`;

    res.redirect(authUrl);
  }

  @Get('auth0_redirect')
  async callback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      if (!state || state === 'undefined') {
        throw new HttpException('Invalid state parameter', HttpStatus.BAD_REQUEST);
      }

      // Parse the combined state to get the original state and redirectTo
      const { state: originalState, redirectTo } = JSON.parse(state);

      const { token } = await this.mpiService.exchangeCodeForToken(code, originalState);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3100';
      const redirectUrl = `${frontendUrl}${redirectTo}?token=${encodeURIComponent(token)}`;
      res.redirect(redirectUrl);
    } catch (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3100';
      res.redirect(`${frontendUrl}?error=auth_failed`);
    }
  }

  @Get('logout')
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const sessionToken = req.headers.authorization?.split(' ')[1];
      if (sessionToken) {
        try {
          const payload = this.jwtService.verify(sessionToken);
          await this.mpiService.logout(payload.userId);
        } catch (error) {
          // Ignore errors when clearing session
        }
      }

      const logoutUrl =
        `https://${process.env.AUTH0_DOMAIN}/v2/logout?` +
        `client_id=${encodeURIComponent(process.env.AUTH0_CLIENT_ID || '')}&` +
        `returnTo=${encodeURIComponent(process.env.FRONTEND_URL || 'http://localhost:3100')}&` +
        `federated`;

      res.redirect(logoutUrl);
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Logout failed' });
    }
  }

  @Get('is_logged_in')
  async isLoggedIn(@Req() req: Request): Promise<{ loggedIn: boolean }> {
    const sessionToken = req.headers.authorization?.split(' ')[1];
    if (!sessionToken) {
      return { loggedIn: false };
    }

    try {
      this.jwtService.verify(sessionToken);
      return { loggedIn: true };
    } catch (error) {
      return { loggedIn: false };
    }
  }

  @Get('user-info')
  async getUserInfo(@Req() req: Request): Promise<any> {
    const sessionToken = req.headers.authorization?.split(' ')[1];
    if (!sessionToken) {
      throw new UnauthorizedException('No session token');
    }

    try {
      const payload = this.jwtService.verify(sessionToken);
      return await this.mpiService.getUserData(payload.userId);
    } catch (error) {
      throw new UnauthorizedException('Invalid session token');
    }
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

  @Get('sequences/:id')
  @UseGuards(AuthGuard)
  async getSequence(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.getSequence(id, userId);
  }

  @Patch('sequences/:id')
  @UseGuards(AuthGuard)
  async updateSequence(@Param('id') id: string, @Body() sequence: Partial<Sequence>, @Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.updateSequence(id, sequence, userId);
  }

  @Delete('sequences/:id')
  @UseGuards(AuthGuard)
  async deleteSequence(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<any> {
    const userId = req.user.userId;
    return this.mpiService.deleteSequence(id, userId);
  }
}
