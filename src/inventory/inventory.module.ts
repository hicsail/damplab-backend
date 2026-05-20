import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InventoryItem, InventoryItemSchema } from './inventory.model';
import { InventoryService } from './inventory.service';
import { InventoryResolver } from './inventory.resolver';
import { InventoryItemPipe } from './inventory.pipe';

@Module({
  imports: [MongooseModule.forFeature([{ name: InventoryItem.name, schema: InventoryItemSchema }])],
  providers: [InventoryService, InventoryResolver, InventoryItemPipe],
  exports: [InventoryService]
})
export class InventoryModule {}
