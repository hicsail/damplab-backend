import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ConfigModule } from '@nestjs/config';
import config from './config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    HealthModule,
    ConfigModule.forRoot({
      load: [config]
    }),
    OrdersModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
    })
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
