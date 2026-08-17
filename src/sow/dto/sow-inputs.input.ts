import { Field, InputType, Int, Float, ID } from '@nestjs/graphql';
import { SOWAdjustmentType } from '../sow.model';

/**
 * The structured drivers behind the calculated sections, as sent by the editor.
 * Mirrors SowVersionInputs; kept as a separate input type so the write surface
 * cannot be widened just by adding a field to the stored model.
 */

@InputType()
export class SowPeriodInput {
  @Field({ description: 'Start of this period. May be in the past — retroactive SOWs are legitimate.' })
  startDate: Date;

  @Field(() => Int, { description: 'Length in days, inclusive of the start date' })
  durationDays: number;

  @Field({ nullable: true, description: 'Optional name, e.g. "Phase 1"' })
  label?: string;
}

@InputType()
export class SowVersionServiceInput {
  @Field(() => ID)
  serviceId: string;

  @Field()
  name: string;

  @Field({ nullable: true, defaultValue: '' })
  description?: string;

  @Field(() => Float, { description: 'Cost for this line. A staff override here writes through to the billing core invoices read.' })
  cost: number;
}

@InputType()
export class SowVersionAdjustmentInput {
  @Field(() => SOWAdjustmentType, {
    description: 'DISCOUNT subtracts, ADDITIONAL_COST adds. SPECIAL_TERM is no longer accepted — it never affected a total; use a custom section for narrative terms.'
  })
  type: SOWAdjustmentType;

  @Field()
  description: string;

  @Field(() => Float)
  amount: number;

  @Field({ nullable: true })
  reason?: string;
}

@InputType()
export class SowInputsInput {
  @Field({ nullable: true, defaultValue: '' })
  projectManager?: string;

  @Field({ nullable: true, description: 'Keycloak sub of the project manager' })
  projectManagerId?: string;

  @Field({ nullable: true, defaultValue: '' })
  projectLead?: string;

  @Field({ nullable: true, description: 'Keycloak sub of the project lead' })
  projectLeadId?: string;

  @Field(() => [SowPeriodInput], { nullable: true, defaultValue: [] })
  periods?: SowPeriodInput[];

  @Field({ nullable: true })
  sowTitle?: string;

  @Field(() => [String], { nullable: true, defaultValue: [] })
  scopeOfWork?: string[];

  @Field(() => [String], { nullable: true, defaultValue: [] })
  deliverables?: string[];

  @Field(() => [SowVersionServiceInput], { nullable: true, defaultValue: [] })
  services?: SowVersionServiceInput[];

  @Field(() => [SowVersionAdjustmentInput], { nullable: true, defaultValue: [] })
  adjustments?: SowVersionAdjustmentInput[];
}
