import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles/roles.decorator';
import { Role } from './roles/roles.enum';
import { User } from './user.interface';

@Injectable()
export class AuthRolesGuard implements CanActivate {
  constructor(private jwtService: JwtService, private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    let request;
    if (context.getType() === 'http') {
      request = context.switchToHttp().getRequest();
    } else if (context.getType<GqlContextType>() === 'graphql') {
      request = GqlExecutionContext.create(context).getContext().req;
    } else {
      throw new UnauthorizedException('Unknown context type');
    }

    const token = this.extractTokenFromHeader(request);
    if (!token) {
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
        throw new ForbiddenException('You do not have the required role');
      }
    } catch (error) {
      throw new UnauthorizedException(`${error.name}: ${error.message || error}`);
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
