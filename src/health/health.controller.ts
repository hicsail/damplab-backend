import { DiskHealthIndicator, HealthCheck, HealthCheckResult, HealthCheckService, HealthIndicatorResult, MemoryHealthIndicator } from '@nestjs/terminus';
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService, private readonly disk: DiskHealthIndicator, private readonly memory: MemoryHealthIndicator) {}

  @Get()
  @HealthCheck()
  healthCheck(): Promise<HealthCheckResult> {
    // TODO: Once configuration is added, remove hard coded limits
    return this.health.check([
      (): PromiseLike<HealthIndicatorResult> => this.disk.checkStorage('storage', { thresholdPercent: 0.5, path: '/' }),
      (): PromiseLike<HealthIndicatorResult> => this.memory.checkHeap('memory_heap', 100 * 1024 * 1024)
    ]);
  }
}
