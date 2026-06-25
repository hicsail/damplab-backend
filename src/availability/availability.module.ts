import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkflowNode, WorkflowNodeSchema } from '../workflow/models/node.model';
import { Booking, BookingSchema } from '../booking/booking.model';
import { AvailabilityService } from './availability.service';

/**
 * Shared inventory-availability pool. Holds only the WorkflowNode + Booking
 * schemas (no module imports) so both WorkflowModule and BookingModule can use
 * AvailabilityService without a circular dependency.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkflowNode.name, schema: WorkflowNodeSchema },
      { name: Booking.name, schema: BookingSchema }
    ])
  ],
  providers: [AvailabilityService],
  exports: [AvailabilityService]
})
export class AvailabilityModule {}
