import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../booking/booking.model';
import { CalendarFeedToken, CalendarFeedTokenSchema } from './calendar-feed-token.model';
import { CalendarFeedService } from './calendar-feed.service';
import { CalendarFeedResolver } from './calendar-feed.resolver';

// Booking is registered here, as AvailabilityModule does, to read it without BookingModule's forwardRef cluster.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CalendarFeedToken.name, schema: CalendarFeedTokenSchema },
      { name: Booking.name, schema: BookingSchema }
    ])
  ],
  providers: [CalendarFeedService, CalendarFeedResolver]
})
export class CalendarFeedModule {}
