import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JobModule } from '../job/job.module';
import { Comment, CommentSchema } from './comment.model';
import { CommentResolver } from './comment.resolver';
import { CommentService } from './comment.service';

@Module({
    imports: [MongooseModule.forFeature([{ name: Comment.name, schema: CommentSchema }]), JobModule],
    providers: [CommentService, CommentResolver]
})
export class CommentModule {}
