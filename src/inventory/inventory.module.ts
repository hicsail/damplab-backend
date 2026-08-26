import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InventoryItem, InventoryItemSchema } from './inventory.model';
import { InventoryService } from './inventory.service';
import { InventoryResolver } from './inventory.resolver';
import { InventoryItemPipe } from './inventory.pipe';
import { UploadLog, UploadLogSchema } from './upload-log.model';
import { UploadLogService } from './upload-log.service';
import { UploadLogResolver } from './upload-log.resolver';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InventoryItem.name, schema: InventoryItemSchema },
      { name: UploadLog.name, schema: UploadLogSchema }
    ])
  ],
  providers: [InventoryService, InventoryResolver, InventoryItemPipe, UploadLogService, UploadLogResolver],
  exports: [InventoryService]
})
export class InventoryModule {}
