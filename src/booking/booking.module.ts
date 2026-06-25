import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from './booking.model';
import { BookingService } from './booking.service';
import { BookingResolver } from './booking.resolver';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: Booking.name, schema: BookingSchema }]), InventoryModule],
  providers: [BookingService, BookingResolver],
  exports: [BookingService]
})
export class BookingModule {}
