import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
import { Booking } from '../booking.model';
import { JobBookingAccessStatus } from '../job-equipment-booking-access';

@ObjectType({ description: 'Whether the caller may book equipment against this job, and why not when they cannot.' })
export class JobBookingAccess {
  @Field(() => JobBookingAccessStatus)
  status: JobBookingAccessStatus;

  @Field(() => Boolean, { description: 'True when at least one operation on this job is bookable by the caller.' })
  canBook: boolean;

  @Field(() => Boolean, { description: 'True when the caller may pause/unpause booking on this job (billing:view).' })
  canBlock: boolean;

  @Field({ nullable: true, description: "The lab's reason, when status is BLOCKED." })
  reason?: string;
}

@ObjectType({ description: "An equipment-use operation's estimated window, as date-only strings." })
export class JobBookingWindow {
  @Field({ nullable: true, description: 'YYYY-MM-DD.' })
  start?: string;

  @Field({ nullable: true, description: 'YYYY-MM-DD. Meaningless when openEnd is true.' })
  end?: string;

  @Field(() => Boolean)
  openEnd: boolean;
}

@ObjectType({ description: 'A bookable inventory item required by an equipment-use operation.' })
export class JobBookingItem {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true, description: 'HOURLY or PER_UNIT.' })
  rateType?: string;

  @Field(() => Boolean, { description: 'False for a consumable — bookable, but not from the job calendar.' })
  schedulable: boolean;
}

@ObjectType({ description: 'One equipment-use operation of a job, and what may be booked against it.' })
export class JobBookingOperation {
  @Field(() => ID, { description: "The workflow node's database id." })
  nodeId: string;

  @Field()
  label: string;

  @Field(() => ID, { nullable: true })
  serviceId?: string;

  @Field(() => Boolean, { description: 'What the Book button obeys: a listed booker is listed per operation.' })
  canBook: boolean;

  @Field(() => JobBookingWindow)
  window: JobBookingWindow;

  @Field(() => Float, { nullable: true })
  hoursPerWeek?: number;

  @Field(() => [JobBookingItem])
  items: JobBookingItem[];

  @Field(() => [String], { description: 'Normalised authorised-booker emails.' })
  bookers: string[];
}

@ObjectType({ description: "Everything the job page's equipment-booking panel needs, in one round trip." })
export class JobEquipmentBookingView {
  @Field(() => JobBookingAccess)
  access: JobBookingAccess;

  @Field(() => [JobBookingOperation], { description: 'Empty for every verdict that is not OPEN.' })
  operations: JobBookingOperation[];

  @Field(() => [Booking], { description: "This job's non-cancelled bookings. Empty for every verdict that is not OPEN." })
  bookings: Booking[];
}
