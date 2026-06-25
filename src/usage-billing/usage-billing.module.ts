import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsageInvoice, UsageInvoiceSchema, UsageSow, UsageSowSchema } from './usage-billing.model';
import { UsageBillingService } from './usage-billing.service';
import { UsageBillingResolver } from './usage-billing.resolver';
import { BookingModule } from '../booking/booking.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UsageSow.name, schema: UsageSowSchema },
      { name: UsageInvoice.name, schema: UsageInvoiceSchema }
    ]),
    BookingModule
  ],
  providers: [UsageBillingService, UsageBillingResolver],
  exports: [UsageBillingService]
})
export class UsageBillingModule {}
