import { DiskHealthIndicator, HealthCheck, HealthCheckResult, HealthCheckService, HealthIndicatorResult, MemoryHealthIndicator } from '@nestjs/terminus';
import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService, private readonly disk: DiskHealthIndicator, private readonly memory: MemoryHealthIndicator, private readonly config: ConfigService) {}

  @Get()
  @HealthCheck()
  healthCheck(): Promise<HealthCheckResult> {
    return this.health.check([
      (): PromiseLike<HealthIndicatorResult> => this.disk.checkStorage('storage', { thresholdPercent: this.config.getOrThrow('health.storageThreshold'), path: '/' }),
      (): PromiseLike<HealthIndicatorResult> => this.memory.checkHeap('memory_heap', this.config.getOrThrow('health.memoryThreshold'))
    ]);
  }
}
