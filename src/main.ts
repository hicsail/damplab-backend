import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: true, bodyParser: false });
  // Allow larger GraphQL payloads (e.g. SOW signature images as base64). Default would be ~100KB.
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));
  await app.listen(3000);
}
bootstrap();
