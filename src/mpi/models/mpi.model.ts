import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { Region } from '../types';

// Register enums
registerEnumType(Region, {
  name: 'Region',
  description: 'The region for screening'
});

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
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => String)
  type: 'dna' | 'rna' | 'aa' | 'unknown';

  @Field()
  seq: string;

  @Field(() => [Annotation], { defaultValue: [] })
  annotations: Annotation[];

  @Field()
  userId: string;

  @Field()
  mpiId: string;

  @Field()
  created_at: Date;

  @Field()
  updated_at: Date;
}

@ObjectType()
export class Organism {
  @Field()
  name: string;

  @Field(() => String)
  organism_type: 'Virus' | 'Toxin' | 'Bacterium' | 'Fungus';

  @Field(() => [String])
  ans: string[];

  @Field(() => [String])
  tags: string[];
}

@ObjectType()
export class HitRegion {
  @Field()
  seq: string;

  @Field()
  seq_range_start: number;

  @Field()
  seq_range_end: number;
}

@ObjectType()
export class HazardHits {
  @Field()
  name: string;

  @Field()
  description: string;

  @Field()
  is_wild_type: boolean;

  @Field(() => [String], { defaultValue: [] })
  references: string[];
}

@ObjectType()
export class RecordHit {
  @Field()
  fasta_header: string;

  @Field(() => [Number])
  line_number_range: number[];

  @Field()
  sequence_length: number;

  @Field(() => [HazardHits])
  hits_by_hazard: HazardHits[];
}

@ObjectType()
export class ScreeningResult {
  @Field(() => ID)
  id: string;

  @Field(() => Sequence)
  sequence: Sequence;

  @Field(() => String)
  region: Region;

  @Field(() => [HazardHits])
  threats: HazardHits[];

  @Field()
  status: string;

  @Field()
  userId: string;

  @Field()
  created_at: Date;

  @Field()
  updated_at: Date;
}
