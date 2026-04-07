import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import { BugAttachment, BugReport } from './bug-report.model';

@InputType({ description: 'Input for creating a new bug report' })
export class CreateBugReportInput {
  @Field({ description: 'Free-form description of the bug as reported by the user' })
  description: string;
}

@InputType({ description: 'Filter options when querying bug reports' })
export class BugReportsFilterInput {
  @Field({ description: 'Full-text search against bug description', nullable: true })
  searchText?: string;

  @Field({ description: 'Filter by reporter email or name (partial, case-insensitive match)', nullable: true })
  reporter?: string;
}

@ObjectType({ description: 'Lightweight view of a bug report for list screens' })
export class BugReportSummary {
  @Field(() => ID)
  id: string;

  @Field()
  description: string;

  @Field({ nullable: true })
  reporterName?: string;

  @Field({ nullable: true })
  reporterEmail?: string;

  @Field()
  createdAt: Date;

  @Field(() => [BugAttachment], { nullable: 'itemsAndList' })
  attachments?: BugAttachment[];
}

@ObjectType({ description: 'Response wrapper for bug report list queries' })
export class BugReportsResult {
  @Field(() => [BugReportSummary])
  items: BugReportSummary[];
}

@InputType({ description: 'Attachment metadata for a bug report after a successful upload' })
export class BugAttachmentInput {
  @Field({ description: 'Original filename of the uploaded file' })
  filename: string;

  @Field({ description: 'S3 key where the uploaded file is stored' })
  key: string;

  @Field({ description: 'MIME type of the uploaded file' })
  contentType: string;

  @Field({ description: 'Size of the uploaded file in bytes' })
  size: number;
}

@InputType({ description: 'File metadata used when requesting presigned upload URLs for bug attachments' })
export class BugAttachmentUploadRequest {
  @Field()
  filename: string;

  @Field()
  contentType: string;

  @Field()
  size: number;
}

@ObjectType({ description: 'Presigned URL details for uploading a single bug attachment' })
export class BugAttachmentUpload {
  @Field()
  filename: string;

  @Field()
  uploadUrl: string;

  @Field()
  key: string;

  @Field()
  contentType: string;

  @Field()
  size: number;
}
