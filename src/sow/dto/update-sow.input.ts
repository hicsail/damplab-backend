import { InputType, Field, Float } from '@nestjs/graphql';
import { SOWTimelineInput, SOWResourcesInput, SOWPricingInput, SOWServiceInput, SOWPricingAdjustmentInput, SOWDiscountInput } from './create-sow.input';
import { SOWStatus } from '../sow.model';

@InputType()
export class UpdateSOWTimelineInput {
  @Field({ description: 'Start date of the project', nullable: true })
  startDate?: Date;

  @Field({ description: 'End date of the project', nullable: true })
  endDate?: Date;

  @Field({ description: 'Duration of the project (e.g., "14 days", "5 weeks")', nullable: true })
  duration?: string;
}

@InputType()
export class UpdateSOWResourcesInput {
  @Field({ description: 'Project manager assigned to the project', nullable: true })
  projectManager?: string;

  @Field({ description: 'Project lead assigned to the project', nullable: true })
  projectLead?: string;
}

@InputType()
export class UpdateSOWPricingInput {
  @Field(() => Float, { description: 'Base cost before adjustments', nullable: true })
  baseCost?: number;

  @Field(() => [SOWPricingAdjustmentInput], { description: 'List of pricing adjustments', nullable: true })
  adjustments?: SOWPricingAdjustmentInput[];

  @Field(() => Float, { description: 'Total cost after adjustments', nullable: true })
  totalCost?: number;

  @Field(() => SOWDiscountInput, { description: 'Discount applied to the pricing', nullable: true })
  discount?: SOWDiscountInput;
}

@InputType()
export class UpdateSOWInput {
  @Field({ description: 'SOW number', nullable: true })
  sowNumber?: string;

  @Field({ description: 'Date the SOW was created', nullable: true })
  date?: Date;

  @Field({ description: 'Name of the client', nullable: true })
  clientName?: string;

  @Field({ description: 'Email address of the client', nullable: true })
  clientEmail?: string;

  @Field({ description: 'Institution of the client', nullable: true })
  clientInstitution?: string;

  @Field({ description: 'Address of the client', nullable: true })
  clientAddress?: string;

  @Field(() => [String], { description: 'Array of scope of work bullet points', nullable: true })
  scopeOfWork?: string[];

  @Field(() => [String], { description: 'Array of deliverable descriptions', nullable: true })
  deliverables?: string[];

  @Field(() => [SOWServiceInput], { description: 'Services included in the SOW', nullable: true })
  services?: SOWServiceInput[];

  @Field(() => UpdateSOWTimelineInput, { description: 'Timeline information', nullable: true })
  timeline?: UpdateSOWTimelineInput;

  @Field(() => UpdateSOWResourcesInput, { description: 'Resource allocation', nullable: true })
  resources?: UpdateSOWResourcesInput;

  @Field(() => UpdateSOWPricingInput, { description: 'Pricing information', nullable: true })
  pricing?: UpdateSOWPricingInput;

  @Field({ description: 'Terms and conditions', nullable: true })
  terms?: string;

  @Field({ description: 'Additional information', nullable: true })
  additionalInformation?: string;

  @Field(() => SOWStatus, { description: 'Status of the SOW', nullable: true })
  status?: SOWStatus;
}
