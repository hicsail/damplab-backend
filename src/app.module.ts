import { Module, DynamicModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import config from './config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { DampLabServicesModule } from './services/damplab-services.module';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkflowModule } from './workflow/workflow.module';
import { CategoriesModule } from './categories/categories.module';
import { BundlesModule } from './bundles/bundles.module';
import { JobModule } from './job/job.module';
import { ResetModule } from './reset/reset.module';
import { CommentModule } from './comment/comment.module';
import { AnnouncementModule } from './announcements/announcement.module';

@Module({
  imports: [
    HealthModule,
    getConfigModule(),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true
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
    WorkflowModule,
    CategoriesModule,
    BundlesModule,
    JobModule,

    // NOTE: The Reset module is for development purposes only and will
    // be removed in future version
    ResetModule,

    CommentModule,
    
    AnnouncementModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}

/**
 * Dynamically load the ConfigModule based on an environment file.
 *
 * - If ENV_FILE is set (e.g., ENV_FILE=dev), it loads `.env.dev`.
 * - If ENV_FILE is not set, it defaults to loading `.env`.
 *
 * This allows:
 *   - Easy switching between multiple environment configs (dev, staging, prod).
 *   - Compatibility with containerized or cloud environments
 *     (where ENV_FILE might not be provided and environment variables are injected directly).
 *
 * Example:
 *   ENV_FILE=staging npm run start
 *   → Loads `.env.staging`
 *
 * If no ENV_FILE is provided:
 *   → Loads `.env`
 */
function getConfigModule(): DynamicModule {
  // Determine which .env file to load
  const envFile = process.env.ENV_FILE
    ? `.env.${process.env.ENV_FILE}`
    : '.env';

  console.info(`Loading config from: ${envFile}`);
  return ConfigModule.forRoot({
    envFilePath: envFile,
    load: [config],
  });
}