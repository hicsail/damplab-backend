import { Module } from '@nestjs/common';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [DampLabServicesModule],
  controllers: [AgentController],
  providers: [AgentService]
})
export class AgentModule {}
