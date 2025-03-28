import { Module } from '@nestjs/common';
import { MPIController } from './mpi.controller';
import { MPIService } from './mpi.service';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '../auth/auth.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecureDNAController } from './secure-dna.controller';

@Module({
  imports: [
    ConfigModule,
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
  providers: [MPIService, AuthGuard],
  exports: [MPIService]
})
export class MPIModule {}
