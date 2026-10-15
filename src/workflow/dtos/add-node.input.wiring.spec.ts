import { CanActivate, ExecutionContext, INestApplication, Injectable, UseGuards } from '@nestjs/common';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Args, GqlExecutionContext, GraphQLModule, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DampLabServices } from '../../services/damplab-services.services';
import { WorkflowParameterFilesService } from '../services/workflow-parameter-files.service';
import { AddNodeInput, AddNodeInputFull, AddNodeInputPipe } from './add-node.input';

/**
 * The key-ownership gate lives in AddNodeInputPipe, which is request-scoped and
 * is handed the GraphQL context as its REQUEST. This boots a real Nest GraphQL
 * app — no database — to prove the pipe sees the caller the auth guard set, on
 * a real request. A unit test that builds the pipe by hand cannot prove that.
 */

@Injectable()
class HeaderAuthGuard implements CanActivate {
  /** Stands in for AuthRolesGuard: writes `user` onto the GraphQL context's `req`, exactly where the real guard does. */
  canActivate(context: ExecutionContext): boolean {
    const req = GqlExecutionContext.create(context).getContext().req;
    req.user = { sub: req.headers['x-test-sub'], realm_access: { roles: [] } };
    return true;
  }
}

@Resolver()
@UseGuards(HeaderAuthGuard)
class SubmitResolver {
  @Query(() => String)
  ping(): string {
    return 'pong';
  }

  @Mutation(() => String)
  submitNode(@Args('node', { type: () => AddNodeInput }, AddNodeInputPipe) node: AddNodeInputFull): string {
    return JSON.stringify(node.formData);
  }
}

const service = {
  _id: 'svc',
  name: 'Sequencing',
  price: 10,
  parameters: [
    { id: 'doc', name: 'Protocol', type: 'file' },
    { id: 'note', name: 'Note', type: 'string' }
  ]
};
const fileValue = (key: string): string => JSON.stringify({ filename: 'protocol.pdf', key, contentType: 'application/pdf', size: 3 });

describe('AddNodeInputPipe sees the caller on a real GraphQL request (F4)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GraphQLModule.forRoot<ApolloDriverConfig>({ driver: ApolloDriver, autoSchemaFile: true })],
      providers: [
        SubmitResolver,
        HeaderAuthGuard,
        AddNodeInputPipe,
        { provide: WorkflowParameterFilesService, useValue: { readObject: jest.fn() } },
        { provide: DampLabServices, useValue: { findOneActive: async (): Promise<typeof service> => service } }
      ]
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const submit = (sub: string, key: string): request.Test =>
    request(app.getHttpServer())
      .post('/graphql')
      .set('x-test-sub', sub)
      .send({
        query: 'mutation ($node: AddNodeInput!) { submitNode(node: $node) }',
        variables: { node: { id: 'n1', label: 'Sequence', serviceId: 'svc', additionalInstructions: '', formData: [{ id: 'doc', value: fileValue(key) }] } }
      });

  it('accepts a key the caller uploaded', async () => {
    const res = await submit('customer-1', 'workflow-parameters/customer-1/protocol.pdf');
    expect(res.body.errors).toBeUndefined();
    expect(JSON.parse(res.body.data.submitNode)[0].id).toBe('doc');
  });

  it('refuses a key another user uploaded', async () => {
    const res = await submit('customer-2', 'workflow-parameters/customer-1/protocol.pdf');
    expect(res.body.data).toBeNull();
    expect(res.body.errors[0].message).toBe('The file on "Sequence" was not uploaded by you. Upload it again and retry.');
  });
});
