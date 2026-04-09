import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityEventEntity, ActivityEventEntitySchema } from './activity-event.model';
import { ActivityService } from './activity.service';
import { ActivityResolver } from './activity.resolver';

@Module({
  imports: [MongooseModule.forFeature([{ name: ActivityEventEntity.name, schema: ActivityEventEntitySchema }])],
  providers: [ActivityService, ActivityResolver],
  exports: [ActivityService]
})
export class ActivityModule {}

