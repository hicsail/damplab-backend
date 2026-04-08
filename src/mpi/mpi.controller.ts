import { Controller, Get, Query, Req, HttpStatus, HttpException, Res, Post } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { Body } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

const MPI_COOKIE = 'mpi_session';

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 24 * 60 * 60 * 1000
});

@Controller('mpi')
export class MPIController {
  constructor(private readonly mpiService: MPIService, private readonly jwtService: JwtService, private readonly configService: ConfigService) {}

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
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

      // Set the MPI session as an httpOnly cookie
      res.cookie(MPI_COOKIE, token, cookieOptions());
      res.redirect(`${frontendUrl}${redirectTo}?mpi_auth=success`);
    } catch (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}?error=auth_failed`);
    }
  }

  @Get('status')
  async isLoggedIn(@Req() req: Request): Promise<{ loggedIn: boolean; userInfo?: any }> {
    const token = req.cookies?.[MPI_COOKIE];
    console.log('MPI Status: cookie present:', !!token, 'cookies:', Object.keys(req.cookies || {}));
    if (!token) {
      return { loggedIn: false };
    }

    try {
      const secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        console.error('MPI Status: JWT_SECRET is missing from ConfigService');
        return { loggedIn: false };
      }
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
      const userData = await this.mpiService.getUserData(payload.userId);
      return {
        loggedIn: true,
        userInfo: userData
      };
    } catch (error) {
      console.error('MPI Status check error:', error?.message);
      return { loggedIn: false };
    }
  }

  @Post('token')
  async exchangeCodeForToken(@Body('code') code: string, @Body('state') state: string, @Res({ passthrough: true }) res: Response): Promise<{ token: string; userInfo: any }> {
    const result = await this.mpiService.exchangeCodeForToken(code, state);
    res.cookie(MPI_COOKIE, result.token, cookieOptions());
    return result;
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<string> {
    const token = req.cookies?.[MPI_COOKIE];
    if (!token) {
      throw new HttpException('Not authenticated with MPI', HttpStatus.UNAUTHORIZED);
    }

    try {
      const secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        throw new HttpException('JWT_SECRET not configured', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
      const result = await this.mpiService.logout(payload.userId);
      res.clearCookie(MPI_COOKIE, { httpOnly: true, sameSite: 'lax' as const, path: '/' });
      return result;
    } catch (error) {
      res.clearCookie(MPI_COOKIE, { httpOnly: true, sameSite: 'lax' as const, path: '/' });
      throw new HttpException('Invalid token', HttpStatus.UNAUTHORIZED);
    }
  }
}
