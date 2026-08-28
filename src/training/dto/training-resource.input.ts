import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { AnnouncementAudience } from '../../audience/audience';

@InputType()
export class CreateTrainingResourceInput {
  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => [AnnouncementAudience], { description: 'At least one. An empty list is an error, not "everyone".' })
  audienceRoles: AnnouncementAudience[];
}

@InputType()
export class UpdateTrainingResourceInput {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => [AnnouncementAudience], { nullable: true, description: 'Omit to leave unchanged. An empty list is an error, not "everyone".' })
  audienceRoles?: AnnouncementAudience[];
}

/** What the browser knows about a file before it has uploaded it. */
@InputType()
export class TrainingFileUploadRequest {
  @Field()
  filename: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;
}

/** What the browser reports back once the PUT to S3 succeeded. */
@InputType()
export class TrainingFileInput {
  @Field()
  filename: string;

  @Field()
  key: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;
}
