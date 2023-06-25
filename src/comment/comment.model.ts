import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType } from '@nestjs/graphql';
import { Job } from '../job/job.model';

@Schema()
@ObjectType({ description: 'Comments describe why a job was accepted/rejected '})
export class Comment {
    @Prop()
    @Field({ description: 'Comment text message ' }) 
    message: string;

    @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: Job.name }] })
    @Field(() => Job,  {description: 'Job which the comment is under'})
    job: mongoose.Types.ObjectId;
}

export type CommentDocument = Comment & Document;
export const CommentSchema = SchemaFactory.createForClass(Comment);