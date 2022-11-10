import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ConfigModule } from '@nestjs/config';
import config from './config';

@Module({
  imports: [
    HealthModule,
    ConfigModule.forRoot({
      load: [config]
    })
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
