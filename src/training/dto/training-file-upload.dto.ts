import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'A presigned S3 PUT the browser uploads to directly.' })
export class TrainingFileUpload {
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
