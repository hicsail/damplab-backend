import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SecureDnaService } from './securedna.service';
import { SecureDnaResolver } from './securedna.resolver';
import { SequenceSchema } from './models/sequence.schema';
import { ScreeningBatchSchema } from './models/screening-batch.schema';
import { KeycloakModule } from '../keycloak/keycloak.module';

@Module({
  imports: [
    ConfigModule,
    KeycloakModule,
    MongooseModule.forFeature([
      { name: 'Sequence', schema: SequenceSchema },
      { name: 'ScreeningBatch', schema: ScreeningBatchSchema }
    ])
  ],
  providers: [SecureDnaService, SecureDnaResolver],
  exports: [SecureDnaService]
})
export class SecureDnaModule {}
