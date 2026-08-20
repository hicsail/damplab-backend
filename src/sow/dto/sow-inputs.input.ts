import { Field, InputType, Int, Float, ID } from '@nestjs/graphql';
import { SOWAdjustmentType, SOWAdjustmentCategory } from '../sow.model';

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

  @Field(() => Float, { description: 'Deprecated and ignored. Service line figures come from the job spec; the document cannot set them.' })
  cost: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Deprecated and ignored. Retained so an older browser bundle does not fail validation; service prices are owned by the job spec.'
  })
  unitCost?: number;
}

@InputType()
export class SowVersionAdjustmentInput {
  @Field(() => SOWAdjustmentType, {
    description: 'DISCOUNT subtracts, ADDITIONAL_COST adds. SPECIAL_TERM is no longer accepted — it never affected a total; use a custom section for narrative terms.'
  })
  type: SOWAdjustmentType;

  @Field()
  description: string;

  @Field(() => Float, { description: 'What this adjustment moves. Ignored when unitAmount is sent — the figure is derived from unitAmount x multiplier.' })
  amount: number;

  @Field(() => Float, { nullable: true, description: 'Amount for a single unit, before the multiplier. This is what the Fee Schedule editor edits; amount follows from it.' })
  unitAmount?: number;

  @Field(() => Float, { nullable: true, description: 'How many units the unit amount is charged for. Omitted means 1.' })
  multiplier?: number;

  @Field(() => SOWAdjustmentCategory, { nullable: true, description: 'What the adjustment is charging for.' })
  category?: SOWAdjustmentCategory;

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

  @Field({ nullable: true, defaultValue: false, description: 'Preview the refreshed Fee Schedule figures rather than the ones carried forward from the current version.' })
  refreshFeeSchedule?: boolean;
}
