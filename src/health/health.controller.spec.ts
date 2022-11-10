import { HealthController } from './health.controller';
import { Test, TestingModule } from '@nestjs/testing';
import { DiskHealthIndicator, HealthCheckError, MemoryHealthIndicator, TerminusModule } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';

describe('HealthController', () => {
  let controller: HealthController;
  let diskHealth: jest.SpiedFunction<DiskHealthIndicator['checkStorage']>;
  let memoryHealth: jest.SpiedFunction<MemoryHealthIndicator['checkHeap']>;
  let configService: jest.SpiedFunction<ConfigService['getOrThrow']>;

  beforeEach(async () => {
    diskHealth = jest.fn().mockResolvedValue({ status: 'ok' });
    memoryHealth = jest.fn().mockResolvedValue({ status: 'ok' });
    configService = jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'health.storageThreshold':
          return 0.75;
        case 'health.memoryThreshold':
          return 100 * 1024 * 1024;
        default:
          throw new Error(`Unexpected key: ${key}`);
      }
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      imports: [TerminusModule],
      providers: [
        { provide: DiskHealthIndicator, useValue: { checkStorage: diskHealth } },
        { provide: MemoryHealthIndicator, useValue: { checkHeap: memoryHealth } },
        { provide: ConfigService, useValue: { getOrThrow: configService } }
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
