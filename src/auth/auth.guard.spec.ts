import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthRolesGuard } from './auth.guard';
import { Permission } from './permissions/permission.enum';
import { PERMISSIONS_KEY } from './permissions/permissions.decorator';
import { ROLES_KEY } from './roles/roles.decorator';
import { Role } from './roles/roles.enum';

/**
 * The guard has no coverage before this. Two things it pins that are easy to break:
 * a permission denial surfacing as **403** (the try/catch used to swallow every
 * ForbiddenException and rethrow it as 401), and DISABLE_AUTH impersonating roles
 * rather than waving everything through.
 */
function contextFor(headers: Record<string, string> = {}): { context: ExecutionContext; request: any } {
  const request: any = { headers };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () =>
      function handler(): void {
        /* identity only; the reflector is stubbed */
      },
    getClass: () => class Cls {}
  } as unknown as ExecutionContext;
  return { context, request };
}

function guardWith(options: { config?: Record<string, any>; metadata?: Record<string, any>; verify?: (token: string) => any }): AuthRolesGuard {
  const configService: any = { get: (key: string) => options.config?.[key] };
  const jwtService: any = {
    verifyAsync: async (token: string) => {
      if (options.verify) return options.verify(token);
      throw Object.assign(new Error('no verifier configured'), { name: 'JsonWebTokenError' });
    }
  };
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => options.metadata?.[key]);
  const apiKeyService: any = { verify: async () => null };
  return new AuthRolesGuard(configService, jwtService, reflector, apiKeyService);
}

const bearer = (roles: string[]): { headers: Record<string, string>; payload: any } => ({ headers: { authorization: 'Bearer token' }, payload: { sub: 'u1', realm_access: { roles } } });

describe('AuthRolesGuard — permission checks', () => {
  it('allows a caller holding the required permission', async () => {
    const { headers, payload } = bearer([Role.DamplabStaff]);
    const guard = guardWith({ metadata: { [PERMISSIONS_KEY]: [Permission.CustomersManage] }, verify: () => payload });
    await expect(guard.canActivate(contextFor(headers).context)).resolves.toBe(true);
  });

  it('allows a caller who reaches the permission through any one of several roles', async () => {
    const { headers, payload } = bearer(['external-customer', Role.Technician]);
    const guard = guardWith({ metadata: { [PERMISSIONS_KEY]: [Permission.BugBacklogView] }, verify: () => payload });
    await expect(guard.canActivate(contextFor(headers).context)).resolves.toBe(true);
  });

  it('denies a caller lacking the permission — with 403, not 401', async () => {
    const { headers, payload } = bearer(['external-customer']);
    const guard = guardWith({ metadata: { [PERMISSIONS_KEY]: [Permission.CustomersManage] }, verify: () => payload });
    await expect(guard.canActivate(contextFor(headers).context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies when only some of several required permissions are held', async () => {
    const { headers, payload } = bearer([Role.Technician]);
    const guard = guardWith({
      metadata: { [PERMISSIONS_KEY]: [Permission.CatalogEditorRead, Permission.CatalogEditorWrite] },
      verify: () => payload
    });
    await expect(guard.canActivate(contextFor(headers).context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('grants a role-less caller the baseline, so open-to-everyone permissions still pass', async () => {
    const { headers, payload } = bearer([]);
    const guard = guardWith({ metadata: { [PERMISSIONS_KEY]: [Permission.JobsView] }, verify: () => payload });
    await expect(guard.canActivate(contextFor(headers).context)).resolves.toBe(true);
  });

  it('does not reuse the roles shortcut: no permission metadata means no permission check', async () => {
    const { headers, payload } = bearer([]);
    const guard = guardWith({ metadata: {}, verify: () => payload });
    await expect(guard.canActivate(contextFor(headers).context)).resolves.toBe(true);
  });
});

describe('AuthRolesGuard — role checks still surface as 403', () => {
  it('denies a missing role with ForbiddenException rather than reclassifying it as 401', async () => {
    const { headers, payload } = bearer(['external-customer']);
    const guard = guardWith({ metadata: { [ROLES_KEY]: [Role.DamplabStaff] }, verify: () => payload });
    await expect(guard.canActivate(contextFor(headers).context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still rejects an unverifiable token with 401', async () => {
    const guard = guardWith({
      metadata: {},
      verify: () => {
        throw Object.assign(new Error('bad signature'), { name: 'JsonWebTokenError' });
      }
    });
    await expect(guard.canActivate(contextFor({ authorization: 'Bearer token' }).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a missing token with 401 when auth is enabled', async () => {
    const guard = guardWith({ metadata: {} });
    await expect(guard.canActivate(contextFor().context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthRolesGuard — DISABLE_AUTH impersonates rather than bypasses', () => {
  it('acts as damplab-staff by default, which is what the bypass always granted', async () => {
    const guard = guardWith({ config: { 'auth.disable': true }, metadata: { [PERMISSIONS_KEY]: [Permission.CustomersManage] } });
    const { context, request } = contextFor();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.realm_access.roles).toEqual([Role.DamplabStaff]);
  });

  it('DEV_AS_ROLES=technician synthesises a technician, and that technician is denied admin-only work', async () => {
    const guard = guardWith({
      config: { 'auth.disable': true, 'auth.devAsRoles': [Role.Technician] },
      metadata: { [PERMISSIONS_KEY]: [Permission.CustomersManage] }
    });
    await expect(guard.canActivate(contextFor().context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('DEV_AS_ROLES lets the impersonated role through what it IS allowed', async () => {
    const guard = guardWith({
      config: { 'auth.disable': true, 'auth.devAsRoles': [Role.Technician] },
      metadata: { [PERMISSIONS_KEY]: [Permission.BugBacklogView] }
    });
    await expect(guard.canActivate(contextFor().context)).resolves.toBe(true);
  });

  it('keeps the real identity but overrides the roles when a token is present', async () => {
    const guard = guardWith({
      config: { 'auth.disable': true, 'auth.devAsRoles': [Role.ClientUnassistedEquipmentUser] },
      metadata: {},
      verify: () => ({ sub: 'real-user', email: 'real@example.com', realm_access: { roles: [Role.DamplabStaff] } })
    });
    const { context, request } = contextFor({ authorization: 'Bearer token' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.sub).toBe('real-user');
    expect(request.user.realm_access.roles).toEqual([Role.ClientUnassistedEquipmentUser]);
  });
});
