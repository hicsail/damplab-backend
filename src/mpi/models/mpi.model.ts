import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { Region } from '../types';

registerEnumType(Region, {
  name: 'Region',
  description: 'The region for screening'
});

export enum SecureDnaHitKind {
  NUC = 'nuc',
  AA = 'aa'
}

registerEnumType(SecureDnaHitKind, {
  name: 'SecureDnaHitKind',
  description: 'Nucleotide vs amino-acid hit from SecureDNA'
});

@ObjectType()
export class Annotation {
  @Field()
  start: number;

  @Field()
  end: number;

  @Field()
  type: string;

  @Field(() => String, { nullable: true })
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

/** SecureDNA / MPI hazard hit shape (full `hits_by_record` / per-sequence `threats` entry). */
@ObjectType()
export class SecureDnaHazardHit {
  @Field(() => SecureDnaHitKind)
  type: SecureDnaHitKind;

  @Field(() => Boolean, { nullable: true })
  is_wild_type: boolean | null;

  @Field(() => [HitRegion])
  hit_regions: HitRegion[];

  @Field(() => Organism)
  most_likely_organism: Organism;

  @Field(() => [Organism])
  organisms: Organism[];
}

@ObjectType()
export class ScreeningDiagnostic {
  @Field()
  diagnostic: string;

  @Field()
  additional_info: string;

  @Field(() => [Number], { nullable: true })
  line_number_range?: number[] | null;
}

@ObjectType()
export class VerifiableScreening {
  @Field(() => String, { nullable: true })
  synthclient_version?: string;

  @Field(() => String, { nullable: true })
  response_json?: string;

  @Field(() => String, { nullable: true })
  signature?: string;

  @Field(() => String, { nullable: true })
  public_key?: string;

  @Field(() => String, { nullable: true })
  history?: string;

  @Field(() => String, { nullable: true })
  sha3_256?: string;
}

@ObjectType()
export class RecordHit {
  @Field()
  fasta_header: string;

  @Field(() => [Number])
  line_number_range: number[];

  @Field()
  sequence_length: number;

  @Field(() => [SecureDnaHazardHit])
  hits_by_hazard: SecureDnaHazardHit[];
}

@ObjectType()
export class ScreeningBatchSequenceSlice {
  @Field(() => Sequence)
  sequence: Sequence;

  @Field()
  mpiSequenceId: string;

  @Field()
  name: string;

  @Field()
  order: number;

  @Field()
  originalSeq: string;

  @Field(() => [SecureDnaHazardHit])
  threats: SecureDnaHazardHit[];

  @Field(() => String, { nullable: true })
  warning?: string;
}

@ObjectType()
export class ScreeningBatch {
  @Field(() => ID)
  id: string;

  @Field()
  mpiBatchId: string;

  @Field()
  mpiCreatedAt: Date;

  @Field()
  synthesisPermission: string;

  @Field(() => String)
  region: Region;

  @Field(() => String, { nullable: true })
  providerReference?: string | null;

  @Field(() => [RecordHit])
  hitsByRecord: RecordHit[];

  @Field(() => [ScreeningDiagnostic])
  warnings: ScreeningDiagnostic[];

  @Field(() => [ScreeningDiagnostic])
  errors: ScreeningDiagnostic[];

  @Field(() => VerifiableScreening, { nullable: true })
  verifiable?: VerifiableScreening;

  @Field(() => [ScreeningBatchSequenceSlice])
  sequences: ScreeningBatchSequenceSlice[];

  @Field()
  userId: string;

  @Field()
  created_at: Date;

  @Field()
  updated_at: Date;
}
