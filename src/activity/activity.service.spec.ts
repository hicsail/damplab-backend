import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ActivityService } from './activity.service';
import { ActivityEventEntity, ActivityEventEntitySchema } from './activity-event.model';

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
      providers: [ActivityService, { provide: getModelToken(ActivityEventEntity.name), useValue: model }]
    }).compile();

    const svc = moduleRef.get(ActivityService);
    await svc.createEvent({ type: 'X', message: 'hello', createdAt: new Date('2026-01-01T00:00:00Z') });
    await svc.createEvent({ type: 'Y', message: 'world', createdAt: new Date('2026-01-01T00:01:00Z') });

    const events = await svc.listEvents({ limit: 10 });
    expect(events).toHaveLength(2);
    expect(events[0].message).toBe('world');
    expect(events[1].message).toBe('hello');
  });

  it('persists SOW linkage and an operation id on an activity event', async () => {
    let created: any;
    const model = {
      create: jest.fn(async (doc: any) => {
        created = { _id: 'evt-sow', ...doc };
        return created;
      })
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ActivityService, { provide: getModelToken(ActivityEventEntity.name), useValue: model }]
    }).compile();

    await moduleRef.get(ActivityService).createEvent({
      type: 'SOW_SENT',
      message: 'SOW sent',
      jobId: 'job-1',
      sowId: 'sow-1',
      sowVersionNumber: 1000,
      operationId: 'SOW_SENT:sow-1:1000'
    } as any);

    expect(created).toMatchObject({
      jobId: 'job-1',
      sowId: 'sow-1',
      sowVersionNumber: 1000,
      operationId: 'SOW_SENT:sow-1:1000'
    });
  });

  it('recovers the winning event when idempotent creates race', async () => {
    const winner = { _id: 'winner', operationId: 'JOB_REVIEWED:review-1', type: 'JOB_REVIEWED', message: 'reviewed' };
    const duplicate: any = new Error('duplicate key');
    duplicate.code = 11000;
    const model = {
      create: jest.fn().mockRejectedValue(duplicate),
      findOne: jest.fn((): any => ({
        exec: async () => winner
      }))
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ActivityService, { provide: getModelToken(ActivityEventEntity.name), useValue: model }]
    }).compile();

    await expect(
      (moduleRef.get(ActivityService) as any).createEventIdempotent({
        operationId: 'JOB_REVIEWED:review-1',
        type: 'JOB_REVIEWED',
        message: 'reviewed'
      })
    ).resolves.toBe(winner);
  });

  it('has a partial unique operation id index so legacy events may coexist', () => {
    const operationIndex = ActivityEventEntitySchema.indexes().find(([keys]) => keys.operationId === 1);

    expect(operationIndex).toEqual([
      { operationId: 1 },
      {
        unique: true,
        partialFilterExpression: { operationId: { $type: 'string' } },
        background: true
      }
    ]);
  });
});
