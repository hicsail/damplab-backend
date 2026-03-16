import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProtocolsIoService } from './protocols-io.service';

@Module({
  imports: [ConfigModule],
  providers: [ProtocolsIoService],
  exports: [ProtocolsIoService]
})
export class ProtocolsIoModule {}

