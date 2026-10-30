import { Field, InputType, ObjectType } from '@nestjs/graphql';

@InputType({ description: 'File metadata for requesting a presigned upload URL for an inventory image.' })
export class InventoryImageUploadRequest {
  @Field()
  filename: string;

  @Field()
  contentType: string;

  @Field()
  size: number;
}

@ObjectType({ description: 'Presigned URL details for uploading an inventory image to S3.' })
export class InventoryImageUpload {
  @Field()
  uploadUrl: string;

  @Field()
  key: string;

  @Field()
  contentType: string;
}
