import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as request from 'supertest';
import { IS_PUBLIC_KEY } from '../auth/roles/roles.decorator';
import { PERMISSIONS_KEY } from '../auth/permissions/permissions.decorator';
import { CalendarFeedController } from './calendar-feed.controller';
import { CalendarFeedService, newFeedToken } from './calendar-feed.service';

const LIVE = newFeedToken();
const BODY = 'BEGIN:VCALENDAR\r\nX-WR-CALNAME:DAMP Lab equipment\r\nEND:VCALENDAR\r\n';

describe('GET /api/calendar/bookings/:token.ics', () => {
  let app: INestApplication;
  const renderFeed = jest.fn(async () => BODY);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CalendarFeedController],
      providers: [{ provide: CalendarFeedService, useValue: { isLiveToken: async (t: unknown): Promise<boolean> => t === LIVE, renderFeed } }]
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => app.close());

  it('serves the calendar to a live token', async () => {
    const res = await request(app.getHttpServer()).get(`/api/calendar/bookings/${LIVE}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.text).toBe(BODY);
  });

  it('ignores any login: a bad Authorization header changes nothing', async () => {
    expect((await request(app.getHttpServer()).get(`/api/calendar/bookings/${LIVE}.ics`).set('Authorization', 'Bearer nonsense')).status).toBe(200);
    expect((await request(app.getHttpServer()).get(`/api/calendar/bookings/${newFeedToken()}.ics`).set('Authorization', 'Bearer nonsense')).status).toBe(404);
  });

  it.each([
    ['an unknown token', `${newFeedToken()}.ics`],
    ['a live token without .ics', LIVE],
    ['a doubled suffix', `${LIVE}.ics.ics`],
    ['a short token', `${LIVE.slice(1)}.ics`],
    ['garbage', 'nope.ics']
  ])('answers %s with an empty 404', async (_name, file) => {
    renderFeed.mockClear();
    const res = await request(app.getHttpServer()).get(`/api/calendar/bookings/${file}`);
    expect(res.status).toBe(404);
    expect(res.text).toBe('');
    expect(renderFeed).not.toHaveBeenCalled();
  });

  it('is public and carries no permission', () => {
    const reflector = new Reflector();
    const targets = [CalendarFeedController.prototype.bookings, CalendarFeedController];
    expect(reflector.getAllAndOverride(IS_PUBLIC_KEY, targets)).toBe(true);
    expect(reflector.getAllAndOverride(PERMISSIONS_KEY, targets)).toBeUndefined();
  });
});
