import { CanActivate, ExecutionContext, ForbiddenException, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import mongoose from 'mongoose';
import * as request from 'supertest';

import { AppModule } from '../../src/app.module';
import { AuthRolesGuard } from '../../src/auth/auth.guard';
import { Permission } from '../../src/auth/permissions/permission.enum';
import { hasAllPermissions } from '../../src/auth/permissions/permissions';
import { PERMISSIONS_KEY } from '../../src/auth/permissions/permissions.decorator';
import { ROLES_KEY } from '../../src/auth/roles/roles.decorator';
import { Role } from '../../src/auth/roles/roles.enum';
import { User } from '../../src/auth/user.interface';
import { DampLabService } from '../../src/services/models/damplab-service.model';
import { SowTextPresetService } from '../../src/sow-preset/sow-text-preset.service';

/**
 * A real NestJS app, a real Mongo, real GraphQL — the parts the unit specs fake.
 *
 * The colocated *.spec.ts files stand mongoose models up as in-memory arrays,
 * which is fast and readable but cannot reproduce the one thing the job/SOW
 * services are built around: a `findOneAndUpdate` whose filter no longer
 * matches. Eleven of those compare-and-set calls carry the review, version and
 * signature flows, and every "someone else got there first" branch hangs off
 * one of them. Those branches only execute against a database.
 */

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

export type ActorName = 'staff' | 'customer' | 'otherCustomer';

export const ACTORS: Record<ActorName, User> = {
  staff: {
    sub: 'staff-sub-1',
    email: 'tech@damplab.test',
    preferred_username: 'Tess Technician',
    realm_access: { roles: [Role.DamplabStaff] }
  },
  customer: {
    sub: 'customer-sub-1',
    email: 'client@bu.test',
    preferred_username: 'Cara Client',
    realm_access: { roles: [Role.InternalCustomer] }
  },
  // A signed-in user who owns nothing here, for the ownership checks that a
  // staff/customer pair alone cannot tell apart from a role check.
  otherCustomer: {
    sub: 'customer-sub-2',
    email: 'stranger@bu.test',
    preferred_username: 'Sam Stranger',
    realm_access: { roles: [Role.InternalCustomer] }
  }
};

/**
 * Stands in for AuthRolesGuard: reads an actor name off `x-test-user` instead of
 * verifying a Keycloak JWT, then applies the same @Roles **and**
 * @RequirePermission checks the real guard does. Skipping either would quietly
 * turn every staff-only assertion in the suite into a no-op, so both are
 * reimplemented rather than dropped.
 *
 * The permission half matters most as resolvers gain `@RequirePermission`: a
 * harness that only mirrored @Roles would keep passing while every narrowing went
 * untested. Note the asymmetry it copies from the real guard — absent @Roles
 * metadata allows, absent permission metadata is simply not checked, but a
 * handler that *does* carry @RequirePermission fails closed.
 */
class TestAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.getType<GqlContextType>() === 'graphql' ? GqlExecutionContext.create(context).getContext().req : context.switchToHttp().getRequest();

    const header = request?.headers?.['x-test-user'];
    if (!header) throw new UnauthorizedException('No x-test-user header');

    const user = ACTORS[header as ActorName];
    if (!user) throw new UnauthorizedException(`Unknown test actor "${header}"`);
    request.user = user;

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    const roles = user.realm_access?.roles ?? [];
    if (requiredRoles?.length && !requiredRoles.some((role) => roles.includes(role))) {
      throw new ForbiddenException('You do not have the required role');
    }

    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (requiredPermissions?.length && !hasAllPermissions(user, requiredPermissions)) {
      throw new ForbiddenException(`Missing permission: ${requiredPermissions.join(', ')}`);
    }

    return true;
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

export interface TestApp {
  app: INestApplication;
  connection: mongoose.Connection;
}

export async function startTestApp(): Promise<TestApp> {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(AuthRolesGuard)
    .useValue(new TestAuthGuard(new Reflector()))
    .compile();

  // Mirrors main.ts: bodyParser off, then an explicit 2mb json limit. The
  // default 100kb ceiling is small enough that a SOW payload can cross it, and
  // a harness that quietly allowed more would hide that.
  const app = moduleFixture.createNestApplication({ bodyParser: false });
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));
  await app.init();

  const connection = app.get<mongoose.Connection>(getConnectionToken());
  return { app, connection };
}

export async function stopTestApp(testApp: TestApp | undefined): Promise<void> {
  await testApp?.app.close();
}

/**
 * Empties every collection between tests, leaving indexes in place — the unique
 * index on `sowNumber` is part of what is under test, and `dropDatabase` would
 * take it with it. Module-init seeding (SowTextPresetService's default text
 * blocks) is re-run afterwards so each test starts from the same catalogue.
 */
export async function resetDb(testApp: TestApp): Promise<void> {
  const db = testApp.connection.db;
  if (!db) throw new Error('Mongo connection is not established');

  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));

  // SowTextPresetService seeds the default text blocks in onModuleInit, which
  // has already run by now — the wipe above takes them with it, so put them
  // back rather than leaving later tests to edit an empty catalogue.
  await testApp.app.get(SowTextPresetService).seedIfEmpty();
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

export interface GqlResponse<T = any> {
  data: T | null;
  errors?: { message: string; extensions?: Record<string, any> }[];
}

/** Posts an operation and returns the raw envelope, errors included. */
export async function gqlRaw<T = any>(testApp: TestApp, actor: ActorName, query: string, variables: Record<string, unknown> = {}): Promise<GqlResponse<T>> {
  const response = await request(testApp.app.getHttpServer()).post('/graphql').set('x-test-user', actor).send({ query, variables });
  return response.body as GqlResponse<T>;
}

/** Posts an operation and returns `data`, failing the test on any GraphQL error. */
export async function gql<T = any>(testApp: TestApp, actor: ActorName, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const body = await gqlRaw<T>(testApp, actor, query, variables);
  if (body.errors?.length) {
    throw new Error(`GraphQL error as ${actor}: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  return body.data as T;
}

/** The single error message from an operation expected to fail. */
export async function gqlError(testApp: TestApp, actor: ActorName, query: string, variables: Record<string, unknown> = {}): Promise<string> {
  const body = await gqlRaw(testApp, actor, query, variables);
  if (!body.errors?.length) throw new Error(`Expected a GraphQL error as ${actor}, got data: ${JSON.stringify(body.data)}`);
  return body.errors.map((e) => e.message).join('; ');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Inserts a catalogue service directly; there is no staff-facing create worth routing through here. */
export async function seedService(testApp: TestApp, overrides: Record<string, unknown> = {}): Promise<string> {
  const model = testApp.app.get<mongoose.Model<any>>(getModelToken(DampLabService.name));
  const created = await model.create({
    name: 'PCR',
    description: 'Polymerase chain reaction',
    icon: 'https://example.test/pcr.png',
    parameters: [],
    allowedConnections: [],
    price: 100,
    internalPrice: 100,
    externalAcademicPrice: 150,
    externalMarketPrice: 250,
    externalNoSalaryPrice: 200,
    deliverables: ['Amplified DNA'],
    isDeleted: false,
    ...overrides
  });
  return String(created._id);
}

/** One service, one node, no edges — the smallest graph a job can be submitted with. */
export function workflowInput(serviceId: string, name = 'Workflow A'): Record<string, unknown> {
  return {
    name,
    nodes: [
      {
        id: 'node-1',
        label: 'PCR',
        serviceId,
        additionalInstructions: 'Handle gently',
        formData: []
      }
    ],
    edges: []
  };
}

/**
 * Parks a SOW number against a throwaway job, so a real job's preferred number
 * ("SOW <its 5-digit display id>") is already taken and it has to fall through
 * to the global sequence. Job display ids are handed out sequentially, so two
 * jobs never otherwise reach for the same number and the collision path in
 * SOWService.create cannot be reached from the front door.
 */
export async function occupySowNumber(testApp: TestApp, sowNumber: string): Promise<void> {
  const db = testApp.connection.db;
  if (!db) throw new Error('Mongo connection is not established');

  // Written through the driver rather than the model on purpose: this is a
  // number reservation, not a SOW, and it should not have to satisfy the schema
  // to hold a slot in the unique index.
  const orphanJob = new mongoose.Types.ObjectId();
  await db.collection('sows').insertOne({ sowNumber, job: orphanJob, jobId: orphanJob.toHexString(), jobName: `placeholder for ${sowNumber}` });
}
