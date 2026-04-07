import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';

@InputType({ description: 'File metadata used when requesting presigned upload URLs for workflow parameter files' })
export class WorkflowParameterFileUploadRequest {
  @Field()
  clientToken: string;

  @Field()
  filename: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;
}

@ObjectType({ description: 'Presigned URL details for uploading a single workflow parameter file' })
export class WorkflowParameterFileUpload {
  @Field()
  clientToken: string;

  @Field()
  filename: string;

  @Field()
  uploadUrl: string;

  @Field()
  key: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;
}
