import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule, Query, Resolver } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import * as request from 'supertest';
import { graphqlOptions } from './graphql-options';

@Resolver()
class ThrowingResolver {
  @Query(() => String)
  boom(): string {
    throw new Error('boom');
  }
}

/**
 * Boot a GraphQL server with graphqlOptions and return the error a failing query
 * produces. NODE_ENV is cleared for the duration, because that is how the
 * deployed containers run, and under jest's NODE_ENV=test Apollo would hide the
 * stack trace by itself and this test would prove nothing.
 */
async function errorFor(includeStacktraces: boolean | undefined): Promise<any> {
  const savedNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true, load: [(): Record<string, unknown> => ({ graphql: { includeStacktraces } })] }),
      GraphQLModule.forRootAsync<ApolloDriverConfig>({
        driver: ApolloDriver,
        imports: [ConfigModule],
        useFactory: graphqlOptions,
        inject: [ConfigService]
      })
    ],
    providers: [ThrowingResolver]
  }).compile();
  const app = moduleRef.createNestApplication();
  try {
    await app.init();
    const res = await request(app.getHttpServer()).post('/graphql').send({ query: '{ boom }' });
    return res.body.errors[0];
  } finally {
    await app.close();
    process.env.NODE_ENV = savedNodeEnv;
  }
}

describe('graphqlOptions', () => {
  it('leaves stack traces out of error responses when NODE_ENV is unset, as in deployments', async () => {
    const error = await errorFor(undefined);
    expect(error.message).toBe('boom');
    expect(error.extensions?.stacktrace).toBeUndefined();
  });

  it('includes them when GRAPHQL_STACKTRACES is on', async () => {
    const error = await errorFor(true);
    expect(error.extensions?.stacktrace).toEqual(expect.any(Array));
  });
});
