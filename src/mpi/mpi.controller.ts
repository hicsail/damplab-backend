import { Controller, Get, Query, Req, HttpStatus, HttpException, Res } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';

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
}
