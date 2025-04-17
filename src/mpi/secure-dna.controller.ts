import { Controller } from '@nestjs/common';
import { MPIService } from './mpi.service';

@Controller('secure-dna')
export class SecureDNAController {
  constructor(private readonly mpiService: MPIService) {}
}
