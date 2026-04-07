import { Controller, Get, Query, Req, HttpStatus, HttpException, Res, Post } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { Body } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

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
      const redirectUrl = `${frontendUrl}${redirectTo}?token=${encodeURIComponent(token)}`;
      res.redirect(redirectUrl);
    } catch (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}?error=auth_failed`);
    }
  }

  @Get('status')
  async isLoggedIn(@Req() req: Request): Promise<{ loggedIn: boolean; userInfo?: any }> {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return { loggedIn: false };
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return { loggedIn: false };
    }

    try {
      // Get secret from ConfigService and use jsonwebtoken directly
      const secret = this.configService.get<string>('JWT_SECRET');
      console.log('MPI Status: Attempting verification, secret exists:', !!secret, 'secret type:', typeof secret, 'secret length:', secret?.length);
      if (!secret) {
        console.error('MPI Status: JWT_SECRET is missing from ConfigService');
        return { loggedIn: false };
      }
      // Use jsonwebtoken directly to bypass NestJS JWT service issues
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
      console.log('MPI Status: JWT verified, userId:', payload.userId);
      const userData = await this.mpiService.getUserData(payload.userId);
      console.log('MPI Status: User data found:', !!userData);
      return {
        loggedIn: true,
        userInfo: userData
      };
    } catch (error) {
      console.error('MPI Status check error:', error);
      console.error('MPI Status check error message:', error?.message);
      console.error('MPI Status check error stack:', error?.stack);
      if (error?.response) {
        console.error('MPI Status check error response:', error.response);
      }
      return { loggedIn: false };
    }
  }

  @Post('token')
  async exchangeCodeForToken(@Body('code') code: string, @Body('state') state: string): Promise<{ token: string; userInfo: any }> {
    return this.mpiService.exchangeCodeForToken(code, state);
  }

  @Post('logout')
  async logout(@Req() req: Request): Promise<string> {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new HttpException('No authorization header', HttpStatus.UNAUTHORIZED);
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new HttpException('No token provided', HttpStatus.UNAUTHORIZED);
    }

    try {
      const secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        throw new HttpException('JWT_SECRET not configured', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      // Use jsonwebtoken directly
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
      return await this.mpiService.logout(payload.userId);
    } catch (error) {
      throw new HttpException('Invalid token', HttpStatus.UNAUTHORIZED);
    }
  }
}
