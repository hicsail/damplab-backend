import { Field, ID, InputType, Int } from '@nestjs/graphql';

@InputType()
export class CreateGuideInput {
  @Field()
  title: string;

  @Field({ nullable: true, description: 'Omit to derive one from the title.' })
  slug?: string;

  @Field({ nullable: true })
  category?: string;

  @Field({ nullable: true })
  body?: string;

  @Field(() => Int, { nullable: true })
  order?: number;

  @Field(() => Boolean, { nullable: true, description: 'Defaults to false — a new guide is a draft until published.' })
  isPublished?: boolean;
}

@InputType()
export class UpdateGuideInput {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  slug?: string;

  @Field({ nullable: true })
  category?: string;

  @Field({ nullable: true })
  body?: string;

  @Field(() => Int, { nullable: true })
  order?: number;

  @Field(() => Boolean, { nullable: true })
  isPublished?: boolean;
}
