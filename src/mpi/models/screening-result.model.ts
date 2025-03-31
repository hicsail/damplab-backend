import { Field, ObjectType } from '@nestjs/graphql';
import { Sequence } from './sequence.model';
import { Region } from '../types';

@ObjectType()
export class HazardHits {
  @Field()
  name: string;

  @Field()
  description: string;

  @Field()
  is_wild_type: boolean;

  @Field(() => [String])
  references: string[];
}

@ObjectType()
export class ScreeningResult {
  @Field()
  id: string;

  @Field(() => Sequence)
  sequence: Sequence;

  @Field(() => String)
  region: Region;

  @Field(() => [HazardHits])
  threats: HazardHits[];

  @Field()
  status: 'pending' | 'completed' | 'failed';

  @Field()
  userId: string;

  @Field()
  created_at: Date;

  @Field()
  updated_at: Date;
}
