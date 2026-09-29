import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Comment, CommentSchema } from './comment.model';
import { CommentResolver } from './comment.resolver';
import { CommentService } from './comment.service';
import { JobModule } from '../job/job.module';
import { ActivityModule } from '../activity/activity.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: Comment.name, schema: CommentSchema }]), forwardRef(() => JobModule), ActivityModule, NotificationModule],
  providers: [CommentService, CommentResolver],
  exports: [CommentService]
})
export class CommentModule {}
