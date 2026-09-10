import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JobPayment, JobPaymentSchema } from './job-payment.model';
import { JobPaymentService } from './job-payment.service';
import { JobCharge, JobChargeSchema } from './job-charge.model';
import { JobChargeService } from './job-charge.service';
import { JobBalanceService } from './job-balance.service';
import { JobPaymentResolver } from './job-payment.resolver';
import { JobChargeResolver } from './job-charge.resolver';
import { BookingModule } from '../booking/booking.module';
import { JobModule } from '../job/job.module';
import { NotificationModule } from '../notification/notification.module';
import { SOWModule } from '../sow/sow.module';
import { Invoice, InvoiceSchema } from '../invoice/invoice.model';

/**
 * BookingModule is imported plainly, not through forwardRef: nothing in the
 * booking cluster imports this module back, which is the whole reason the
 * balance service lives here rather than in `src/booking/`. Job and
 * Notification keep forwardRef because they already forward-reference each
 * other. SOWModule is also forwardRef: nothing in the SOW cluster imports
 * this module back either, but SOWModule itself sits behind other forwardRefs
 * (JobModule, NotificationModule) that make its own construction order
 * unpredictable, so JobBalanceService resolves SOWService/SowVersionService
 * lazily rather than assuming SOWModule is ready first.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: JobPayment.name, schema: JobPaymentSchema },
      { name: JobCharge.name, schema: JobChargeSchema },
      // Read-only access to the Invoice collection: JobPaymentService validates
      // that an invoiceId belongs to the job and is live. This is deliberately
      // a second forFeature registration of Invoice's model (Mongoose reuses
      // the already-compiled model rather than re-registering it), not an
      // import of InvoiceModule/InvoiceService — that would create a
      // JobPaymentModule <-> InvoiceModule forwardRef cycle.
      { name: Invoice.name, schema: InvoiceSchema }
    ]),
    BookingModule,
    forwardRef(() => JobModule),
    forwardRef(() => NotificationModule),
    forwardRef(() => SOWModule)
  ],
  providers: [JobPaymentService, JobChargeService, JobBalanceService, JobPaymentResolver, JobChargeResolver],
  exports: [JobPaymentService, JobChargeService, JobBalanceService]
})
export class JobPaymentModule {}
