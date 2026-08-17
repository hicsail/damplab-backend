import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import { BugAttachment, BugSeverity } from './bug-report.model';

@InputType({ description: 'Input for creating a new bug report' })
export class CreateBugReportInput {
  @Field({ description: 'Free-form description of the bug as reported by the user' })
  description: string;

  @Field(() => BugSeverity, { description: 'Reported severity', nullable: true })
  severity?: BugSeverity;

  @Field({ description: 'Page or feature the bug is on', nullable: true })
  area?: string;

  @Field({ description: 'Numbered steps to reproduce', nullable: true })
  stepsToReproduce?: string;

  @Field({ description: 'What the reporter expected', nullable: true })
  expected?: string;

  @Field({ description: 'What actually happened', nullable: true })
  actual?: string;

  @Field({ description: 'Optional session/campaign tag (e.g. "testathon")', nullable: true })
  tag?: string;
}

@InputType({ description: 'Filter options when querying bug reports' })
export class BugReportsFilterInput {
  @Field({ description: 'Full-text search against bug description', nullable: true })
  searchText?: string;

  @Field({ description: 'Filter by reporter email or name (partial, case-insensitive match)', nullable: true })
  reporter?: string;

  @Field(() => BugSeverity, { description: 'Filter by severity', nullable: true })
  severity?: BugSeverity;

  @Field({ description: 'Filter by session/campaign tag (exact match)', nullable: true })
  tag?: string;
}

@ObjectType({ description: 'Lightweight view of a bug report for list screens' })
export class BugReportSummary {
  @Field(() => ID)
  id: string;

  @Field()
  description: string;

  @Field(() => BugSeverity, { nullable: true })
  severity?: BugSeverity;

  @Field({ nullable: true })
  area?: string;

  @Field({ nullable: true })
  stepsToReproduce?: string;

  @Field({ nullable: true })
  expected?: string;

  @Field({ nullable: true })
  actual?: string;

  @Field({ nullable: true })
  tag?: string;

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
