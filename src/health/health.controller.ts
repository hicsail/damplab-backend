import { DiskHealthIndicator, HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { Controller, Get } from '@nestjs/common';


@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly disk: DiskHealthIndicator,
    private readonly memory: MemoryHealthIndicator) {}

  @Get()
  @HealthCheck()
  healthCheck() {
    // TODO: Once configuration is added, remove hard coded limits
    return this.health.check([
      () => this.disk.checkStorage('storage', { thresholdPercent: 0.5, path: '/' }),
      () => this.memory.checkHeap('memory_heap', 100 * 1024 * 1024),
    ]);
  }
}
