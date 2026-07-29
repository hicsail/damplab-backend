import { Field, ID, InputType, Int, ObjectType, Float, registerEnumType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

@InputType()
export class UpsertProtocolStepMappingInput {
  @Field() protocolId: string;
  @Field() stepId: string;
  @Field({ nullable: true }) stepNumber?: string;
  @Field({ nullable: true }) stepTitle?: string;
  @Field(() => ID, { nullable: true }) serviceId?: string;
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

@ObjectType({ description: 'A mapped Canvas service reference (with validity).' })
export class ResolvedService {
  @Field(() => ID) id: string;
  @Field({ nullable: true }) name?: string;
  @Field(() => Boolean, { description: 'True if the referenced service no longer exists / is deleted.' })
  missing: boolean;
}

@ObjectType({ description: 'A required equipment resolved to its station.' })
export class ResolvedEquipment {
  @Field(() => ID) id: string;
  @Field({ nullable: true }) name?: string;
  @Field(() => Boolean) missing: boolean;
  @Field(() => ResolvedStation, { nullable: true }) station?: ResolvedStation;
}

@ObjectType({ description: 'A protocol step with its fully resolved service → equipment → station chain.' })
export class ResolvedStep {
  @Field() stepId: string;
  @Field({ nullable: true }) number?: string;
  @Field({ nullable: true }) title?: string;
  @Field(() => StepMappingStatus) status: StepMappingStatus;
  @Field(() => ResolvedService, { nullable: true }) service?: ResolvedService;
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
