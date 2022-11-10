import { HealthController } from './health.controller';
import { Test, TestingModule } from '@nestjs/testing';
import { DiskHealthIndicator, HealthCheckError, MemoryHealthIndicator, TerminusModule } from '@nestjs/terminus';

describe('HealthController', () => {
  let controller: HealthController;
  let diskHealth: jest.SpiedFunction<DiskHealthIndicator['checkStorage']>;
  let memoryHealth: jest.SpiedFunction<MemoryHealthIndicator['checkHeap']>;

  beforeEach(async () => {
    diskHealth = jest.fn().mockResolvedValue({ status: 'ok' });
    memoryHealth = jest.fn().mockResolvedValue({ status: 'ok' });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      imports: [TerminusModule],
      providers: [
        { provide: DiskHealthIndicator, useValue: { checkStorage: diskHealth } },
        { provide: MemoryHealthIndicator, useValue: { checkHeap: memoryHealth } }
      ]
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return ok when all health checks pass', async () => {
    const result = await controller.healthCheck();

    expect(result.status).toEqual('ok');
  });

  it('should return error if any of the health checks fail', async () => {
    diskHealth.mockRejectedValue(new HealthCheckError('Disk check failed', { disk: { status: 'error' } }));

    try {
      await controller.healthCheck();

      // Should throw an error, if this is reached then an error was
      // not thrown
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.getStatus()).toEqual(503);
      expect(e.getResponse().status).toEqual('error');
    }
  });
});
