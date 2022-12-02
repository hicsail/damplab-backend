import { Module, DynamicModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import config from './config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { DampLabServicesModule } from './services/damplab-services.module';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [
    HealthModule,
    getConfigModule(),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'dist/schema.gql')
    }),
    // Load the MongoDB connection based on the config service
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get('database.uri')
      }),
      inject: [ConfigService]
    }),
    DampLabServicesModule,
    WorkflowModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}

/**
 * Get the config module based on the specific environment file to load from.
 *
 * This function checkfor the existence of the environemnt variable
 * `ENV_FILE`. If it exists, the function will load the config from that file,
 * if that file does not exist, only use existing environment variables.
 * For example, if `ENV_FILE=dev` then the file `.env.dev` will be loaded.
 *
 * Part of the benefit of this approach is that tools that allow you to
 * enter environment variables are easily supported such as docker-compose.
 * In such cases, by not providing an `ENV_FILE` environment variable, the
 * config will be loaded from the environment variables.
 */
function getConfigModule(): DynamicModule {
  // If the `ENV_FILE` is provided, load from that file
  if (process.env.ENV_FILE) {
    console.info('Loading config from file: .env.' + process.env.ENV_FILE);
    return ConfigModule.forRoot({
      envFilePath: `.env.${process.env.ENV_FILE}`,
      load: [config]
    });
  }

  // Otherwise don't load from a file, just use the environment variables
  console.info('Loading config from environment variables');
  return ConfigModule.forRoot({
    ignoreEnvFile: true,
    load: [config]
  });
}
