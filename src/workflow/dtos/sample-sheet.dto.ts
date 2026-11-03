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

@InputType({ description: 'An uploaded table file: the key createWorkflowParameterUploadUrls minted for it. The server reads the file to check its columns and count its rows.' })
export class SampleSheetFileInput {
  @Field()
  key: string;

  @Field()
  filename: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;

  @Field(() => Int, { description: 'Ignored. The server reads the uploaded file and stores its own row count; this field is kept so existing clients keep working.' })
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
