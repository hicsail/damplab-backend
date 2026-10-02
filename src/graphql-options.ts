import { ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigService } from '@nestjs/config';

/**
 * Options for the GraphQL module, read through ConfigService so they see .env.
 *
 * Stack traces are set explicitly. Apollo includes one in every error response
 * unless NODE_ENV is "production" or "test", and no deployment sets NODE_ENV,
 * so staging and production were returning server file paths and internals to
 * any caller. Setting NODE_ENV=production instead would also turn off
 * introspection and the GraphiQL page, which the public docs link to.
 */
export function graphqlOptions(configService: ConfigService): Omit<ApolloDriverConfig, 'driver'> {
  return {
    autoSchemaFile: true,
    graphiql: true,
    includeStacktraceInErrorResponses: configService.get<boolean>('graphql.includeStacktraces') === true
  };
}
