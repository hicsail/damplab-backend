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
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
          console.error('MPI Module: JWT_SECRET is missing or invalid');
          throw new Error('JWT_SECRET environment variable is not set or is invalid');
        }
        console.log('MPI Module: JWT_SECRET configured, length:', secret.length, 'type:', typeof secret);
        return {
          secret: secret,
          signOptions: { expiresIn: '24h', algorithm: 'HS256' }
        };
      },
      inject: [ConfigService]
    })
  ],
  controllers: [MPIController, SecureDNAController],
  providers: [MPIService, AuthGuard, MPIResolver],
  exports: [MPIService]
})
export class MPIModule {}
