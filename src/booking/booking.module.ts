import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from './booking.model';
import { BookingService } from './booking.service';
import { BookingResolver } from './booking.resolver';
import { JobEquipmentBookingService } from './job-equipment-booking.service';
import { InventoryModule } from '../inventory/inventory.module';
import { AvailabilityModule } from '../availability/availability.module';
import { JobModule } from '../job/job.module';
import { SOWModule } from '../sow/sow.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { DampLabServicesModule } from '../services/damplab-services.module';

/**
 * Job / SOW / Workflow are imported through `forwardRef` because they already
 * forward-reference each other; nothing in that cluster imports BookingModule, so
 * this adds no new cycle (only AppModule and UsageBillingModule reach it).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Booking.name, schema: BookingSchema }]),
    InventoryModule,
    AvailabilityModule,
    forwardRef(() => JobModule),
    forwardRef(() => SOWModule),
    forwardRef(() => WorkflowModule),
    DampLabServicesModule
  ],
  providers: [BookingService, BookingResolver, JobEquipmentBookingService],
  exports: [BookingService, JobEquipmentBookingService]
})
export class BookingModule {}
