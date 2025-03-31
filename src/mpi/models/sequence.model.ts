import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Annotation {
  @Field()
  start: number;

  @Field()
  end: number;

  @Field()
  type: string;

  @Field({ nullable: true })
  description?: string;
}

@ObjectType()
export class Sequence {
  @Field()
  id: string;

  @Field()
  name: string;

  @Field()
  type: 'dna' | 'rna' | 'aa' | 'unknown';

  @Field()
  seq: string;

  @Field(() => [Annotation])
  annotations: Annotation[];

  @Field()
  userId: string;

  @Field()
  created_at: Date;

  @Field()
  updated_at: Date;
}
