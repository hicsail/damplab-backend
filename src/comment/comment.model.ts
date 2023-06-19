import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { Job } from '../job/job.model';

@Schema()
@ObjectType({ description: 'Comments describe why a job was accepted/rejected '})
export class Comment {
    @Field(() => ID, { name: 'id' })
    _id: string;

    @Prop()
    @Field({ description: 'Comment text message ' })
    message: string;

    @Prop()
    @Field(() => Job,  {description: 'Corresponding job id '})
    job: mongoose.Types.ObjectId;
}
export type CommentDocument = Comment & Document;
export const CommentSchema = SchemaFactory.createForClass(Comment);