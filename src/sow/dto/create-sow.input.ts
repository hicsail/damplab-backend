import { InputType, Field, Float } from '@nestjs/graphql';
import { SOWStatus, SOWAdjustmentType } from '../sow.model';

@InputType()
export class SOWTimelineInput {
  @Field({ description: 'Start date of the project' })
  startDate: Date;

  @Field({ description: 'End date of the project' })
  endDate: Date;

  @Field({ description: 'Duration of the project (e.g., "14 days", "5 weeks")' })
  duration: string;
}

@InputType()
export class SOWResourcesInput {
  @Field({ description: 'Project manager assigned to the project' })
  projectManager: string;

  @Field({ description: 'Project lead assigned to the project' })
  projectLead: string;
}

@InputType()
export class SOWPricingAdjustmentInput {
  @Field(() => SOWAdjustmentType, { description: 'Type of adjustment' })
  type: SOWAdjustmentType;

  @Field({ description: 'Description of the adjustment' })
  description: string;

  @Field(() => Float, { description: 'Amount of the adjustment' })
  amount: number;

  @Field({ description: 'Reason for the adjustment', nullable: true })
  reason?: string;
}

@InputType()
export class SOWDiscountInput {
  @Field(() => Float, { description: 'Discount amount' })
  amount: number;

  @Field({ description: 'Reason for the discount' })
  reason: string;
}

@InputType()
export class SOWPricingInput {
  @Field(() => Float, { description: 'Base cost before adjustments' })
  baseCost: number;

  @Field(() => [SOWPricingAdjustmentInput], { description: 'List of pricing adjustments', defaultValue: [] })
  adjustments: SOWPricingAdjustmentInput[];

  @Field(() => Float, { description: 'Total cost after adjustments' })
  totalCost: number;

  @Field(() => SOWDiscountInput, { description: 'Discount applied to the pricing', nullable: true })
  discount?: SOWDiscountInput;
}

@InputType()
export class SOWServiceInput {
  @Field({ description: 'Service ID from DampLabService' })
  id: string;

  @Field({ description: 'Name of the service' })
  name: string;

  @Field({ description: 'Description of the service' })
  description: string;

  @Field(() => Float, { description: 'Cost of the service' })
  cost: number;

  @Field({ description: 'Category of the service' })
  category: string;
}

@InputType()
export class CreateSOWInput {
  @Field({ description: 'ID of the job this SOW is for' })
  jobId: string;

  @Field({ description: 'SOW number (auto-generated if not provided)', nullable: true })
  sowNumber?: string;

  @Field({ description: 'Date the SOW was created', nullable: true })
  date?: Date;

  @Field({ description: 'Name of the client' })
  clientName: string;

  @Field({ description: 'Email address of the client' })
  clientEmail: string;

  @Field({ description: 'Institution of the client' })
  clientInstitution: string;

  @Field({ description: 'Address of the client', nullable: true })
  clientAddress?: string;

  @Field(() => [String], { description: 'Array of scope of work bullet points' })
  scopeOfWork: string[];

  @Field(() => [String], { description: 'Array of deliverable descriptions' })
  deliverables: string[];

  @Field(() => [SOWServiceInput], { description: 'Services included in the SOW' })
  services: SOWServiceInput[];

  @Field(() => SOWTimelineInput, { description: 'Timeline information' })
  timeline: SOWTimelineInput;

  @Field(() => SOWResourcesInput, { description: 'Resource allocation' })
  resources: SOWResourcesInput;

  @Field(() => SOWPricingInput, { description: 'Pricing information' })
  pricing: SOWPricingInput;

  @Field({ description: 'Terms and conditions' })
  terms: string;

  @Field({ description: 'Additional information', nullable: true })
  additionalInformation?: string;

  @Field({ description: 'User who created the SOW (technician username/email)' })
  createdBy: string;

  @Field(() => SOWStatus, { description: 'Status of the SOW', defaultValue: SOWStatus.DRAFT, nullable: true })
  status?: SOWStatus;
}
