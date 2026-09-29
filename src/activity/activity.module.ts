import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityEventEntity, ActivityEventEntitySchema } from './activity-event.model';
import { ActivityService } from './activity.service';
import { ActivityResolver } from './activity.resolver';
import { JobModule } from '../job/job.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: ActivityEventEntity.name, schema: ActivityEventEntitySchema }]), forwardRef(() => JobModule)],
  providers: [ActivityService, ActivityResolver],
  exports: [ActivityService]
})
export class ActivityModule {}
