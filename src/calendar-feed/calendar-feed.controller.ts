import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../auth/roles/roles.decorator';
import { CalendarFeedService } from './calendar-feed.service';

/**
 * The token in the URL is the gate. Calendar apps fetch without a session, so no login is read and
 * the feed cannot recheck `inventory:schedule` (see FINDINGS on revocation).
 */
@Public()
@Controller('api/calendar')
export class CalendarFeedController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Get('bookings/:file')
  async bookings(@Param('file') file: string, @Res() res: Response): Promise<void> {
    const token = file.endsWith('.ics') ? file.slice(0, -'.ics'.length) : '';
    if (!(await this.feeds.isLiveToken(token))) {
      res.status(404).end();
      return;
    }
    res
      .status(200)
      .set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' })
      .send(await this.feeds.renderFeed());
  }
}
