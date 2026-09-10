import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JobPayment, JobPaymentSchema } from './job-payment.model';
import { JobPaymentService } from './job-payment.service';
import { JobEquipmentBalanceService } from './job-equipment-balance.service';
import { JobPaymentResolver } from './job-payment.resolver';
import { BookingModule } from '../booking/booking.module';
import { JobModule } from '../job/job.module';
import { NotificationModule } from '../notification/notification.module';

/**
 * BookingModule is imported plainly, not through forwardRef: nothing in the
 * booking cluster imports this module back, which is the whole reason the
 * balance service lives here rather than in `src/booking/`. Job and Notification
 * keep forwardRef because they already forward-reference each other.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: JobPayment.name, schema: JobPaymentSchema }]), BookingModule, forwardRef(() => JobModule), forwardRef(() => NotificationModule)],
  providers: [JobPaymentService, JobEquipmentBalanceService, JobPaymentResolver],
  exports: [JobPaymentService, JobEquipmentBalanceService]
})
export class JobPaymentModule {}
