import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class CreateJobEquipmentBookingInput {
  @Field(() => ID, { description: 'The job this booking is billed to.' })
  jobId: string;

  @Field(() => ID, { description: "Workflow node id of the job's equipment-use operation." })
  nodeId: string;

  @Field(() => ID, { description: "One of the operation's schedulable inventory items." })
  inventoryItemId: string;

  @Field({ description: 'Reservation start.' })
  startTime: Date;

  @Field({ description: 'Reservation end.' })
  endTime: Date;

  @Field({ nullable: true, description: 'Defaults to "Job #<jobId> · <operation>" when blank.' })
  notes?: string;
}

@InputType()
export class UpdateJobEquipmentBookingInput {
  @Field()
  startTime: Date;

  @Field()
  endTime: Date;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true, description: 'Why the booking is changing. Required; recorded in the booking’s history.' })
  reason?: string;
}
