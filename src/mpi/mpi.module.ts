import { Module } from '@nestjs/common';
import { MPIController } from './mpi.controller';
import { MPIService } from './mpi.service';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '../auth/auth.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default_jwt_secret',
      signOptions: { expiresIn: '1d' }
    })
  ],
  controllers: [MPIController],
  providers: [MPIService, AuthGuard],
  exports: [MPIService]
})
export class MPIModule {}
