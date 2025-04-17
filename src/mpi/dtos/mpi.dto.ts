import { Field, InputType } from '@nestjs/graphql';
import { Region } from '../types';

@InputType()
export class AnnotationInput {
  @Field()
  start: number;

  @Field()
  end: number;

  @Field()
  type: string;

  @Field({ nullable: true })
  description?: string;
}

@InputType()
export class CreateSequenceInput {
  @Field()
  name: string;

  @Field()
  type: 'dna' | 'rna' | 'aa' | 'unknown';

  @Field()
  seq: string;

  @Field(() => [AnnotationInput], { nullable: true })
  annotations?: AnnotationInput[];
}

@InputType()
export class ScreeningInput {
  @Field()
  sequenceId: string;

  @Field(() => String)
  region: Region;
}

@InputType()
export class BatchScreeningInput {
  @Field(() => [String])
  sequenceIds: string[];

  @Field(() => String)
  region: Region;
}
