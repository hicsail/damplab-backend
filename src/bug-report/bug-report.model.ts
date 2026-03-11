import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Field, ObjectType, ID } from '@nestjs/graphql';

@ObjectType({ description: 'File attached to a bug report (e.g. screenshot)' })
export class BugAttachment {
  @Field({ description: 'Original filename of the uploaded file', nullable: true })
  filename?: string;

  @Field({ description: 'S3 object key where the file is stored' })
  key: string;

  @Field({ description: 'MIME type of the uploaded file' })
  contentType: string;

  @Field({ description: 'Size of the file in bytes' })
  size: number;

  @Field({ description: 'When this attachment was recorded', nullable: true })
  uploadedAt?: Date;

  @Field({ description: 'Temporary URL to download this attachment', nullable: true })
  url?: string;
}

@Schema()
@ObjectType({ description: 'User-submitted bug report for the DAMPLab UI' })
export class BugReport {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true })
  @Field({ description: 'Free-form description of the bug as reported by the user' })
  description: string;

  @Prop({ required: false })
  @Field({ description: 'Name of the user who reported the bug (if available)', nullable: true })
  reporterName?: string;

  @Prop({ required: false })
  @Field({ description: 'Email of the user who reported the bug (if available)', nullable: true })
  reporterEmail?: string;

  @Prop({ default: new Date() })
  @Field({ description: 'When this bug report was created' })
  createdAt: Date;

  @Prop({
    type: [
      {
        filename: String,
        key: String,
        contentType: String,
        size: Number,
        uploadedAt: Date
      }
    ],
    default: []
  })
  @Field(() => [BugAttachment], {
    description: 'Optional screenshots or files attached to this bug report',
    nullable: 'itemsAndList'
  })
  attachments?: BugAttachment[];
}

export type BugReportDocument = BugReport & Document;
export const BugReportSchema = SchemaFactory.createForClass(BugReport);

