import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';

@InputType({ description: 'File metadata for presigning a blank samples-spreadsheet template upload.' })
export class SampleSheetTemplateUploadRequest {
  @Field()
  filename: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;
}

@ObjectType({ description: 'Presigned PUT for a blank samples-spreadsheet template. Store `key` on the parameter as templateFile.key once the PUT succeeds.' })
export class SampleSheetTemplateUpload {
  @Field()
  uploadUrl: string;

  @Field()
  key: string;
}

@InputType({ description: 'An uploaded samples spreadsheet: the key createWorkflowParameterUploadUrls minted for it, and the count read from it.' })
export class SampleSheetFileInput {
  @Field()
  key: string;

  @Field()
  filename: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;

  @Field(() => Int, { description: 'Rows below the header row, as counted when the file was picked.' })
  sampleCount: number;
}

@InputType()
export class ReplaceSampleSheetInput {
  @Field(() => ID)
  jobId: string;

  @Field(() => ID, { description: 'The workflow node’s database id (`_id`), not its canvas id.' })
  nodeId: string;

  @Field()
  parameterId: string;

  @Field(() => SampleSheetFileInput)
  file: SampleSheetFileInput;
}
