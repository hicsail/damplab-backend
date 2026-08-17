import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ROLES_KEY } from './roles/roles.decorator';
import { Role } from './roles/roles.enum';
import { User } from './user.interface';
import { ApiKeyService } from '../api-key/api-key.service';

@Injectable()
export class AuthRolesGuard implements CanActivate {
  constructor(private configService: ConfigService, private jwtService: JwtService, private reflector: Reflector, private apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    let request;
    if (context.getType() === 'http') {
      request = context.switchToHttp().getRequest();
    } else if (context.getType<GqlContextType>() === 'graphql') {
      request = GqlExecutionContext.create(context).getContext().req;
    } else {
      throw new UnauthorizedException('Unknown context type');
    }

    // API-key path: external systems authenticate with `x-api-key` for READ-ONLY
    // GraphQL access. Placed before the JWT block so its 403s aren't reclassified.
    const apiKeyHeader = this.extractApiKey(request);
    if (apiKeyHeader) {
      return this.authorizeApiKey(context, request, apiKeyHeader);
    }

    const token = this.extractTokenFromHeader(request);
    if (token === undefined) {
      if (this.configService.get('auth.disable')) {
        console.debug('Auth is disabled for development - AuthRolesGuard not enforcing auth.');
        return true;
      }
      throw new UnauthorizedException('No token found');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);

      request['user'] = payload as User;

      const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
      if (!requiredRoles || requiredRoles.length === 0) {
        return true;
      }

      const roles = payload.realm_access?.roles ?? [];
      const hasRole = requiredRoles.some((role) => roles.includes(role));
      if (!hasRole) {
        if (this.configService.get('auth.disable')) {
          console.debug('Auth is disabled for development - AuthRolesGuard not enforcing auth roles.');
          return true;
        }
        throw new ForbiddenException('You do not have the required role');
      }
    } catch (error) {
      throw new UnauthorizedException(`${error.name}: ${error.message}`);
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private extractApiKey(request: any): string | undefined {
    const h = request?.headers?.['x-api-key'];
    return typeof h === 'string' && h.length > 0 ? h : undefined;
  }

  /**
   * Authorize a request bearing an API key. Verified once per request (memoized
   * on the request). API keys are read-only: only GraphQL queries are allowed —
   * mutations/subscriptions and non-GraphQL endpoints are rejected. Role checks
   * are bypassed for reads (the key itself is the authorization).
   */
  private async authorizeApiKey(context: ExecutionContext, request: any, rawKey: string): Promise<boolean> {
    let key = request['apiKey'];
    if (!key) {
      key = await this.apiKeyService.verify(rawKey);
      if (!key) {
        throw new UnauthorizedException('Invalid or revoked API key');
      }
      request['apiKey'] = key;
      request['user'] = { sub: 'apikey:' + key._id, apiKey: true, readOnly: true, preferred_username: key.name, realm_access: { roles: [] } };
    }
    if (context.getType<GqlContextType>() !== 'graphql') {
      throw new ForbiddenException('API keys can only be used against the GraphQL endpoint.');
    }
    const operation = GqlExecutionContext.create(context).getInfo()?.operation?.operation;
    if (operation && operation !== 'query') {
      throw new ForbiddenException('API keys are read-only — only GraphQL queries are permitted.');
    }
    return true;
  }
}
