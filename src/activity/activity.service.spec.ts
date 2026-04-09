import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ActivityService } from './activity.service';
import { ActivityEventEntity } from './activity-event.model';

describe('ActivityService', () => {
  it('creates and lists events', async () => {
    const createdDocs: any[] = [];
    const model = {
      create: jest.fn(async (doc: any) => {
        const saved = { _id: 'evt1', ...doc };
        createdDocs.push(saved);
        return saved;
      }),
      find: jest.fn(() => ({
        sort: jest.fn(() => ({
          limit: jest.fn(() => ({
            lean: jest.fn(() => ({
              exec: jest.fn(async () => createdDocs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)))
            }))
          }))
        }))
      }))
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ActivityService,
        { provide: getModelToken(ActivityEventEntity.name), useValue: model }
      ]
    }).compile();

    const svc = moduleRef.get(ActivityService);
    await svc.createEvent({ type: 'X', message: 'hello', createdAt: new Date('2026-01-01T00:00:00Z') });
    await svc.createEvent({ type: 'Y', message: 'world', createdAt: new Date('2026-01-01T00:01:00Z') });

    const events = await svc.listEvents({ limit: 10 });
    expect(events).toHaveLength(2);
    expect(events[0].message).toBe('world');
    expect(events[1].message).toBe('hello');
  });
});

