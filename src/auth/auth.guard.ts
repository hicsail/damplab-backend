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
import { PERMISSIONS_KEY } from './permissions/permissions.decorator';
import { Permission } from './permissions/permission.enum';
import { hasAllPermissions } from './permissions/permissions';

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

    const authDisabled = Boolean(this.configService.get('auth.disable'));
    const token = this.extractTokenFromHeader(request);

    if (token === undefined) {
      if (authDisabled) {
        // Impersonate rather than skip: a bypass that grants everything makes every
        // permission gate untestable locally. DEV_AS_ROLES defaults to damplab-staff,
        // which is exactly the omnipotent identity this branch used to hand out.
        request['user'] = this.devUser();
        return this.authorize(context, request['user']);
      }
      throw new UnauthorizedException('No token found');
    }

    let payload: User;
    try {
      payload = (await this.jwtService.verifyAsync(token)) as User;
    } catch (error) {
      // Only token verification is wrapped. The authorization failures below must
      // surface as 403 -- they used to be caught here and rethrown as 401, so the
      // JWT path could not emit a Forbidden at all.
      throw new UnauthorizedException(`${error.name}: ${error.message}`);
    }

    if (authDisabled) {
      // Keep the real identity (sub/email drive ownership checks) but let
      // DEV_AS_ROLES decide what they may do.
      payload = { ...payload, realm_access: { roles: this.devRoles() } };
      console.debug(`Auth is disabled for development - acting as roles: ${this.devRoles().join(', ')}`);
    }

    request['user'] = payload;
    return this.authorize(context, payload);
  }

  /**
   * Role and permission checks, in that order.
   *
   * `@Roles` keeps its historical shape: absent metadata means allow, and any one of
   * the listed roles suffices. `@RequirePermission` does NOT reuse that shortcut --
   * a handler carrying it is denied unless the resolved set covers every listed
   * permission. Both are evaluated; neither replaces the other.
   */
  private authorize(context: ExecutionContext, user: User): boolean {
    const roles = user?.realm_access?.roles ?? [];

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (requiredRoles?.length && !requiredRoles.some((role) => roles.includes(role))) {
      throw new ForbiddenException('You do not have the required role');
    }

    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (requiredPermissions?.length && !hasAllPermissions(user, requiredPermissions)) {
      throw new ForbiddenException(`Missing permission: ${requiredPermissions.join(', ')}`);
    }

    return true;
  }

  /**
   * Roles to act as when DISABLE_AUTH is on.
   *
   * `undefined` means DEV_AS_ROLES was never set — fall back to `damplab-staff`,
   * which is what the bypass granted before it could impersonate. An **empty
   * array** means it was set to nothing on purpose: that caller carries no roles
   * and resolves to the client baseline, which is the only way to walk the client
   * tier locally. Treating the two the same handed out an administrator instead.
   */
  private devRoles(): string[] {
    const configured = this.configService.get<string[] | undefined>('auth.devAsRoles');
    return configured === undefined ? [Role.DamplabStaff] : configured;
  }

  private devUser(): User {
    return {
      preferred_username: 'dev',
      sub: 'dev',
      email: 'dev@local',
      realm_access: { roles: this.devRoles() }
    };
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

    // Permission checks DO apply to keys (against API_KEY_PERMISSIONS, which excludes
    // internal-fields:read). The `@Roles` bypass above is left exactly as it was: a
    // key still satisfies every @Roles(DamplabStaff) query, as it does today.
    // Removing that bypass would narrow live integrations, so it belongs with the
    // rest of the narrowing work.
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (requiredPermissions?.length && !hasAllPermissions(request['user'], requiredPermissions)) {
      throw new ForbiddenException(`Missing permission: ${requiredPermissions.join(', ')}`);
    }
    return true;
  }
}
