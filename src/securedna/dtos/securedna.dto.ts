import { Field, InputType } from '@nestjs/graphql';
import { MAX_SECUREDNA_SEQUENCE_BATCH } from '../securedna.constants';
import { Region } from '../region';

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
export class BatchScreeningInput {
  @Field(() => [String])
  sequenceIds: string[];

  @Field(() => Region)
  region: Region;

  @Field({ nullable: true, description: 'Optional label forwarded to SecureDNA as provider_reference' })
  providerReference?: string;
}

@InputType()
export class BatchCreateSequencesInput {
  @Field(() => [CreateSequenceInput], {
    description: `At most ${MAX_SECUREDNA_SEQUENCE_BATCH} sequences per request (SecureDNA batch limit).`
  })
  sequences: CreateSequenceInput[];
}
