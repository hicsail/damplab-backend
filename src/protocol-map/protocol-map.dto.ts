import { Field, ID, InputType, Int, ObjectType, Float, registerEnumType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

/**
 * A step maps to EQUIPMENT only. There is deliberately no per-step service:
 * the operation↔protocol association lives on the operation (DampLabService
 * .protocolIds), so asking again per step was redundant and let the two
 * disagree. Mappings stay keyed on (protocolId, stepId), which means a protocol
 * shared by several operations shares one equipment map — intended.
 */
@InputType()
export class UpsertProtocolStepMappingInput {
  @Field() protocolId: string;
  @Field() stepId: string;
  @Field({ nullable: true }) stepNumber?: string;
  @Field({ nullable: true }) stepTitle?: string;
  @Field(() => [ID], { nullable: true }) equipmentIds?: string[];
  @Field({ nullable: true }) requiresNoEquipment?: boolean;
  @Field(() => JSON, { nullable: true }) paramTags?: any;
  @Field({ nullable: true }) reviewed?: boolean;
}

/** Per-step resolution status in the combined workflow. */
export enum StepMappingStatus {
  UNMAPPED = 'UNMAPPED',
  MAPPED = 'MAPPED',
  BROKEN = 'BROKEN'
}
registerEnumType(StepMappingStatus, { name: 'StepMappingStatus' });

@ObjectType({ description: 'Station a piece of equipment resolves to.' })
export class ResolvedStation {
  @Field(() => ID) id: string;
  @Field() name: string;
  @Field({ nullable: true }) type?: string;
  @Field({ nullable: true }) zone?: string;
  @Field(() => Float, { nullable: true }) x?: number;
  @Field(() => Float, { nullable: true }) y?: number;
}

@ObjectType({ description: 'One station a piece of equipment is placed at, and how many are there.' })
export class ResolvedPlacement {
  @Field(() => ResolvedStation) station: ResolvedStation;
  @Field(() => Int) quantity: number;
}

@ObjectType({ description: 'Equipment required by a step, resolved to every station it is placed at.' })
export class ResolvedEquipment {
  @Field(() => ID) id: string;
  @Field({ nullable: true }) name?: string;
  @Field(() => Boolean) missing: boolean;
  @Field(() => [ResolvedPlacement], { description: 'Stations holding this equipment. Empty means it has no station assigned.' })
  placements: ResolvedPlacement[];
}

@ObjectType({ description: 'A protocol step with its fully resolved equipment → station chain. Steps are returned in execution order.' })
export class ResolvedStep {
  @Field() stepId: string;
  @Field({ nullable: true }) number?: string;
  @Field({ nullable: true }) title?: string;
  @Field(() => StepMappingStatus) status: StepMappingStatus;
  @Field(() => [ResolvedEquipment]) equipment: ResolvedEquipment[];
  @Field(() => Boolean) requiresNoEquipment: boolean;
  @Field(() => [String], { description: 'Validation problems for this step (empty if clean).' }) issues: string[];
}

@ObjectType({ description: 'A protocol resolved into the full step → service → equipment → station chain.' })
export class ResolvedProtocol {
  @Field() protocolId: string;
  @Field({ nullable: true }) title?: string;
  @Field(() => Boolean, { description: 'True when every step is MAPPED with valid references.' }) fullyMapped: boolean;
  @Field(() => Int) totalStepCount: number;
  @Field(() => Int) mappedStepCount: number;
  @Field(() => [ResolvedStep]) steps: ResolvedStep[];
}
