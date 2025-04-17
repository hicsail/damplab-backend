import { Module } from '@nestjs/common';
import { MPIController } from './mpi.controller';
import { MPIService } from './mpi.service';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '../auth/auth.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecureDNAController } from './secure-dna.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { TokenStoreSchema } from './models/token-store.model';
import { MPIResolver } from './mpi.resolver';
import { SequenceSchema } from './models/sequence.schema';
import { ScreeningResultSchema } from './models/screening-result.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: 'TokenStore', schema: TokenStoreSchema },
      { name: 'Sequence', schema: SequenceSchema },
      { name: 'ScreeningResult', schema: ScreeningResultSchema }
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '24h' }
      }),
      inject: [ConfigService]
    })
  ],
  controllers: [MPIController, SecureDNAController],
  providers: [MPIService, AuthGuard, MPIResolver],
  exports: [MPIService]
})
export class MPIModule {}
